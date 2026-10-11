import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { packageCameraApp } from "./package-camera.ts";
import { installCameraPackages } from "./prepare-camera.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson, prepareConfig, projectEnvironment } from "../packages/cli/src/project.ts";

const framework = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv.slice(2).find(value => !value.startsWith("--")) ?? ".spark/examples/SparkCameraKitchenSink");
const probeOnly = process.argv.includes("--probe-only");
const mode = process.argv.includes("--release") ? "release" : "dev";
if (!process.argv.includes("--run-only")) {
  await prepareKitchenSink(root);
  cpSync(path.join(root, "App.tsx"), path.join(root, "KitchenSink.tsx"));
  for (const file of ["CameraText.tsx", "NitroCompatibility.tsx", probeOnly ? "ProbeApp.tsx" : "App.tsx"]) cpSync(path.join(framework, "examples/camera", file), path.join(root, file === "ProbeApp.tsx" ? "App.tsx" : file));
  if (!probeOnly) cpSync(path.join(framework, "examples/camera/CameraDemo.tsx"), path.join(root, "CameraDemo.tsx"));
  await installCameraPackages(root);
  const config = readJson(path.join(root, "desktop.config.json"));
  config.macos.infoPlist = { ...config.macos.infoPlist,
    NSCameraUsageDescription: "Try camera preview and capture in the Spark camera example.",
    NSMicrophoneUsageDescription: "Record audio with your camera test videos.",
    NSCameraUseContinuityCameraDeviceType: true };
  writeJson(path.join(root, "desktop.config.json"), config); prepareConfig(root);
  writeJson(path.join(root, "tsconfig.json"), { extends: "expo/tsconfig.base", compilerOptions: { strict: true, skipLibCheck: true }, include: ["*.ts", "*.tsx"], exclude: ["node_modules"] });
}
if (process.argv.includes("--prepare-only")) { console.log(`Prepared ${root}`); process.exit(0); }
const result = process.argv.includes("--run-only") ? readJson(path.join(root, `.spark/${mode}-build.json`)) : await build(root, mode, process.argv.includes("--force"));
const directory = path.join(root, ".spark/camera-proof"); mkdirSync(directory, { recursive: true });
const report = path.join(directory, `${probeOnly ? "nitro" : "camera"}-${mode}.json`); rmSync(report, { force: true });
const port = await availablePort();
let metro: ReturnType<typeof spawnProcess> | undefined;
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  if (mode === "dev") {
    writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "camera-proof", port });
    const log = processLog(path.join(directory, "metro.log"));
    metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log });
    const deadline = Date.now() + 120000; let ready = false;
    while (!ready && Date.now() < deadline) {
      ready = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false);
      if (metro.exitCode !== null) throw new Error(`Metro exited; see ${directory}`);
      if (!ready) await sleep(250);
    }
    if (!ready) throw new Error(`Metro timed out; see ${directory}`);
  }
  const executable = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(result.app, "Contents/Info.plist")], { capture: true })).trim();
  const log = processLog(path.join(directory, `${mode}.log`));
  app = spawnProcess([path.join(result.app, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-camera-proof", report], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log });
  const deadline = Date.now() + 120000;
  while (!existsSync(report) && Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null) throw new Error(`App exited before report (code ${app.exitCode}, signal ${app.signalCode}). Close any other instance of this example and inspect ${directory}`);
    await sleep(200);
  }
  if (!existsSync(report)) throw new Error(`Native proof timed out; see ${directory}`);
  const outcome = readJson(report); console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.passed) throw new Error(`Native proof failed: ${report}`);
  console.log(`PASS: ${report}\nApp: ${result.app}`);
  if (mode === "release" && !probeOnly) console.log(`Test kit: ${await packageCameraApp(result.app, report)}`);
  if (process.argv.includes("--interactive")) {
    process.once("SIGINT", () => app?.kill()); process.once("SIGTERM", () => app?.kill());
    console.log("The example is open. Press Ctrl+C to close it."); await app.exited;
  }
} finally {
  if (app) { app.kill(); await app.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  rmSync(path.join(root, ".spark/session.json"), { force: true });
}
