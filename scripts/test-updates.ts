import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson, prepareConfig } from "../packages/cli/src/project.ts";

// This integration specifically validates standalone behavior and needs Release.
const root = path.resolve(process.argv[2] ?? ".spark/update-tests/UpdateProbe");
await prepareKitchenSink(root);
const configFile = path.join(root, existsSync(path.join(root, "desktop.config.json")) ? "desktop.config.json" : "app.json");
const appFile = path.join(root, "App.tsx");
const originalConfig = readFileSync(configFile, "utf8");
const originalApp = readFileSync(appFile, "utf8");
const report = path.join(root, ".spark/release-update-report.json");
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  const config = readJson(configFile);
  const { publicKey } = generateKeyPairSync("ed25519");
  const framework = config.expo ? config.expo.extra.spark : config;
  framework.menuBarOnly = true;
  framework.updates = { feedURL: "https://example.com/updates/appcast.xml", publicKey: (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64") };
  writeJson(configFile, config);
  writeFileSync(appFile, `import React, { useEffect } from "react";
import { Text } from "react-native";
import { getUpdateStatus, startUpdates } from "@legendapp/spark/updates";
import { writeText } from "@legendapp/spark/files";
import { getWindow } from "@legendapp/spark/windows";
export default function App() {
  useEffect(() => { (async () => {
    let result;
    try {
      const before = await getUpdateStatus();
      await startUpdates();
      const after = await getUpdateStatus();
      await startUpdates();
      const again = await getUpdateStatus();
      const window = await getWindow();
      result = { passed: before.available && !before.started && after.started && after.canCheck && !after.automaticallyChecks && again.started && !window.visible, before, after, window };
    } catch (error) { result = { passed: false, error: String(error) }; }
    await writeText(${JSON.stringify(report)}, JSON.stringify(result));
  })(); }, []);
  return <Text>Standalone updater and menu bar test</Text>;
}`);
  const result = await build(root, "release");
  if (!existsSync(path.join(result.app, "Contents/Frameworks/Sparkle.framework"))) throw new Error("Sparkle was not embedded");
  const info = JSON.parse(await run(root, ["plutil", "-convert", "json", "-o", "-", path.join(result.app, "Contents/Info.plist")], { capture: true }));
  if (!info.LSUIElement || !info.SparkMenuBarOnly || !info.SURequireSignedFeed || !info.SUVerifyUpdateBeforeExtraction) throw new Error("Release updater/menu-bar CNG settings missing");
  await run(root, ["codesign", "--verify", "--deep", "--strict", result.app], { capture: true });
  rmSync(report, { force: true });
  const log = processLog(path.join(root, ".spark/update-release.log"));
  app = spawnProcess([path.join(result.app, "Contents/MacOS", info.CFBundleExecutable)], { cwd: root, stdout: log, stderr: log });
  const deadline = Date.now() + 30000;
  while (!existsSync(report) && Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null) throw new Error("Release app exited before reporting");
    await sleep(100);
  }
  if (!existsSync(report)) throw new Error(`Release update test timed out: ${root}/.spark/update-release.log`);
  const outcome = readJson(report);
  if (!outcome.passed) throw new Error(`Release updater checks failed: ${JSON.stringify(outcome)}`);
  console.log(`PASS: standalone Release loads Sparkle, starts idempotently, preserves disabled automatic checks, and hides the menu-bar-only app window. No Metro or feed request. Report: ${report}`);
  app.kill(); await app.exited; app = undefined;
  const currentPackage = readFileSync(path.join(root, "package.json"), "utf8");
  writeFileSync(configFile, originalConfig); prepareConfig(root);
  try {
    await run(root, [binary(root, "expo-desktop"), "prebuild", "--platform", "macos", "--template", "expo-desktop-template-bare-minimum@54.81.1-beta.6", "--no-install"], { env: { CI: "1" }, capture: true });
    const regenerated = JSON.parse(await run(root, ["plutil", "-convert", "json", "-o", "-", path.join(root, "macos", `${info.CFBundleExecutable}-macOS`, "Info.plist")], { capture: true }));
    if (regenerated.SUFeedURL || regenerated.SUPublicEDKey || regenerated.SURequireSignedFeed || regenerated.LSUIElement || regenerated.SparkMenuBarOnly) throw new Error("Removed update/menu-bar configuration survived CNG");
    console.log("PASS: prebuild removes stale update feed/key and resets menu-bar-only activation");
  } finally { writeFileSync(path.join(root, "package.json"), currentPackage); }

} finally {
  if (app) { app.kill(); await app.exited; }
  writeFileSync(configFile, originalConfig); prepareConfig(root); writeFileSync(appFile, originalApp);
}
