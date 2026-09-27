import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson, prepareConfig } from "../packages/cli/src/project.ts";

// All test effects live in this dedicated app. The driver is absent from Go.
const reducedApp = `import React, { useEffect } from "react";
import { Text } from "react-native";
import { getStringAsync } from "@legendapp/spark/clipboard";
import { getAppContext } from "@legendapp/spark/app";
import { writeText, getDirectory } from "@legendapp/spark/files";
export default function App({ launchArguments = [] }) {
  useEffect(() => {
    const report = launchArguments[launchArguments.indexOf("--spark-test-report") + 1];
    Promise.all([getStringAsync(), getAppContext(), getDirectory("data")]).then(([text, context, dataDirectory]) =>
      writeText(report, JSON.stringify({ passed: typeof text === "string", context, dataDirectory, results: [{ name: "pruned native APIs execute", passed: typeof text === "string" }] })));
  }, []);
  return <Text>Reduced runtime: app, clipboard and filesystem</Text>;
}
`;
const root = path.resolve(process.argv[2] ?? ".spark/native-tests/KitchenSinkTests");
await prepareKitchenSink(root);
const packageFile = path.join(root, "package.json");
let pkg = readJson(packageFile);
if (pkg.dependencies["@legendapp/spark-sdk-test-driver"]) {
  delete pkg.dependencies["@legendapp/spark-sdk-test-driver"]; writeJson(packageFile, pkg);
  await run(root, managerCommand(packageManager(root), ["install"]));
}
const go = await build(root, "go");
const port = await availablePort();
const reportDir = path.join(root, ".spark/test-results"); mkdirSync(reportDir, { recursive: true });
writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "test", port });
const metroLog = processLog(path.join(reportDir, "metro.log"));
const startMetro = () => { writeFileSync(path.join(reportDir, "metro.log"), ""); return spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1" }, stdout: metroLog, stderr: metroLog }); };
let metro = startMetro();
let appProcess: ReturnType<typeof spawnProcess> | undefined;
async function waitFor<T>(read: () => Promise<T | undefined>, timeout: number, description: string): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await read(); if (result !== undefined) return result; await sleep(200); }
  throw new Error(`Timed out: ${description}. See ${reportDir}`);
}
async function execute(app: string, phase: string, projectId: string, extraArgs: string[] = [], development = true) {
  const reportFile = path.join(reportDir, `${phase}-${Date.now()}.json`);
  const executableName = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleExecutable", path.join(app, "Contents/Info.plist")], { capture: true })).trim();
  writeFileSync(path.join(reportDir, `${phase}.log`), "");
  const appLog = processLog(path.join(reportDir, `${phase}.log`));
  appProcess = spawnProcess([path.join(app, "Contents/MacOS", executableName), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-test-report", reportFile, ...extraArgs], {
    cwd: root, env: { ...process.env, SPARK_PROJECT_ID: projectId, SPARK_PROJECT_NAME: "SDK Tests", SPARK_PROJECT_VERSION: "9.8.7", SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=${development}&minify=false` }, stdout: appLog, stderr: appLog,
  });
  try {
    const result = await waitFor(async () => {
      if (existsSync(reportFile)) return readJson(reportFile);
      if ((appProcess!.exitCode !== null || appProcess!.signalCode !== null)) throw new Error(`Native test app exited early: ${appProcess!.exitCode}`);
      return existsSync(reportFile) ? readJson(reportFile) : undefined;
    }, 120000, phase);
    for (const check of result.results ?? []) console.log(`${check.passed ? "PASS" : "FAIL"} [${phase}] ${check.name}${check.error ? `: ${check.error}` : ""}`);
    if (!result.passed) throw new Error(`Native suite failed: ${reportFile}${result.error ? `: ${result.error}` : ""}`);
    if (phase === "custom" && !result.results.some((check: any) => check.name === "app: quit interception cancels termination")) throw new Error("Custom test driver checks did not execute");
    if (phase.startsWith("go-") && result.context.version !== "9.8.7") throw new Error("Go returned its host version instead of the project version");
    if (phase.startsWith("go-") && result.context.projectId !== projectId) throw new Error("Go ignored the launching project's identity");
    if (extraArgs.includes("--spark-test-quit-on-complete")) {
      await waitFor(async () => (appProcess!.exitCode !== null || appProcess!.signalCode !== null) ? true : undefined, 10000, "accepted quit");
      if (appProcess.exitCode !== 0) throw new Error(`Accepted quit exited ${appProcess.exitCode}`);
      console.log("PASS [custom] accepted quit terminates the app");
    }
    return result;
  } finally { appProcess.kill(); await appProcess.exited; appProcess = undefined; }
}
async function executeUI(app: string) {
  if (process.env.SPARK_TEST_UI_DRIVER === "external") {
    console.log("External UI driver: wait for the Save panel named accepted.txt, then press its Save button.");
    return execute(app, "custom", "embedded-custom-identity", ["--spark-test-quit-on-complete"]);
  }
  const directory = path.join(root, ".spark/ui-tests");
  mkdirSync(directory, { recursive: true });
  const fixture = path.resolve(import.meta.dirname, "../tests/native-ui");
  cpSync(fixture, directory, { recursive: true });
  const report = path.join(reportDir, `custom-ui-${Date.now()}.json`);
  writeJson(path.join(directory, "configuration.json"), { app, report, location: `127.0.0.1:${port}`, bundleURL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` });
  await run(root, ["ruby", path.join(directory, "create-project.rb"), directory], { capture: true });
  await run(root, ["xcodebuild", "-project", path.join(directory, "SDKUITests.xcodeproj"), "-scheme", "SDKUITests", "-destination", "platform=macOS,arch=arm64", "-derivedDataPath", path.join(directory, "DerivedData"), "-resultBundlePath", path.join(reportDir, `ui-${Date.now()}.xcresult`), "CODE_SIGN_IDENTITY=-", "test"], { capture: true });
  const result = readJson(report);
  for (const check of result.results ?? []) console.log(`${check.passed ? "PASS" : "FAIL"} [custom] ${check.name}${check.error ? `: ${check.error}` : ""}`);
  if (!result.passed || !result.results.some((check: any) => check.name === "app: quit interception cancels termination")) throw new Error(`Custom native checks did not pass: ${report}`);
  console.log("PASS [custom] XCTest save acceptance and accepted guarded quit");
  return result;
}
async function ready() {
  await waitFor(async () => fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok ? true : undefined, () => undefined), 60000, "Metro startup");
}
async function restartMetro() { metro.kill(); await metro.exited; metro = startMetro(); await ready(); }
const testIdentity = `spark.native-tests.${crypto.randomUUID()}`;
const configFile = path.join(root, existsSync(path.join(root, "desktop.config.json")) ? "desktop.config.json" : "app.json");
const originalConfig = readFileSync(configFile, "utf8");
const originalApp = readFileSync(path.join(root, "App.tsx"), "utf8");
try {
  await waitFor(async () => fetch(`http://127.0.0.1:${port}/status`).then(response => response.ok ? true : undefined, () => undefined), 60000, "Metro startup");
  const first = await execute(go.app, "go-project-a", `${testIdentity}.a`, ["--spark-isolation-expect", "absent"]);
  const second = await execute(go.app, "go-project-b", `${testIdentity}.b`, ["--spark-isolation-expect", "absent", "--spark-isolation-cleanup"]);
  const resumed = await execute(go.app, "go-project-a-again", `${testIdentity}.a`, ["--spark-isolation-expect", "present", "--spark-isolation-cleanup"]);
  if (first.dataDirectory === second.dataDirectory || first.dataDirectory !== resumed.dataDirectory) throw new Error("Go storage isolation failed");
  pkg = readJson(packageFile); delete pkg.dependencies["@legendapp/spark-sdk-test-driver"]; writeJson(packageFile, pkg);
  await run(root, managerCommand(packageManager(root), ["install"]));
  writeFileSync(path.join(root, "test-driver.ts"), 'export type TestDriver = { call(method: string, args: string): Promise<string> };\nexport const testDriver: TestDriver | undefined = undefined;\n');
  writeFileSync(path.join(root, "App.tsx"), reducedApp);
  const preview = await build(root, "preview");
  for (const name of ["native-menu", "context-menu", "desktop-windows", "desktop-shortcuts", "desktop-links", "file-dialog", "secure-storage", "notifications", "tray", "updates", "processes", "global-shortcuts", "system", "message-dialog", "drag-drop"]) {
    if (preview.runtime.modules[name === "desktop" ? "@legendapp/spark" : `@legendapp/spark-${name}`]) throw new Error(`Unused native package survived pruning: ${name}`);
  }
  for (const name of ["react-native-webview", "@op-engineering/op-sqlite"]) if (preview.runtime.modules[name]) throw new Error(`Unused library survived pruning: ${name}`);
  for (const name of ["desktop-app", "clipboard", "file-system"]) {
    if (!preview.runtime.modules[name === "desktop" ? "@legendapp/spark" : `@legendapp/spark-${name}`]) throw new Error(`Used package was removed: ${name}`);
  }
  if (existsSync(path.join(preview.app, "Contents/Frameworks/Sparkle.framework"))) throw new Error("Unused Sparkle framework survived pruning");
  const binaryDirectory = path.join(preview.app, "Contents/MacOS");
  const debugLibrary = readdirSync(binaryDirectory).find(name => name.endsWith(".debug.dylib"));
  if (!debugLibrary) throw new Error("Expected the Debug executable library for binary pruning verification");
  const symbols = await run(root, ["nm", "-gU", path.join(binaryDirectory, debugLibrary)], { capture: true });
  for (const name of ["RNNativeMenu", "RNContextMenu", "RNDesktopWindows", "RNDesktopShortcuts", "RNDesktopLinks", "RNFileDialog", "RNDesktopSecureStorage", "RNSDKTestDriver", "RNDesktopNotifications", "RNDesktopTray", "RNDesktopUpdates", "SPUUpdater", "RNDesktopProcesses", "RNDesktopGlobalShortcuts", "RNDesktopSystem", "RNDesktopMessageDialog", "RNDesktopDragView", "RNCWebView", "OPSQLite"]) {
    if (symbols.includes(`_OBJC_CLASS_$_${name}`)) throw new Error(`Unused native class is still linked: ${name}`);
  }
  for (const name of ["RNDesktopApp", "RNDesktopClipboard", "RNDesktopFileSystem"]) {
    if (!symbols.includes(`_OBJC_CLASS_$_${name}`)) throw new Error(`Used native class is missing: ${name}`);
  }
  await restartMetro();
  await execute(preview.app, "reduced", "ignored-in-preview", [], false);
  console.log("PASS [reduced] unused SDK modules, WebView and SQLite removed from binary; retained APIs run");
  writeFileSync(path.join(root, "App.tsx"), originalApp);
  pkg = readJson(packageFile);
  pkg.dependencies["@legendapp/spark-sdk-test-driver"] = pkg.overrides["@legendapp/spark-sdk-test-driver"];
  writeJson(packageFile, pkg); await run(root, managerCommand(packageManager(root), ["install"]));
  writeFileSync(path.join(root, "test-driver.ts"), 'import driver from "@legendapp/spark-sdk-test-driver";\nexport type TestDriver = typeof driver;\nexport const testDriver: TestDriver = driver;\n');
  const customConfig = readJson(configFile);
  const source = customConfig.expo ?? customConfig;
  source.scheme = "spark-sdk-test";
  const framework = customConfig.expo ? source.extra.spark : source;
  framework.documentTypes = [{ name: "SDK text document", contentTypes: ["public.plain-text"], role: "Viewer" }];
  writeJson(configFile, customConfig);
  const custom = await build(root, "dev");
  const info = JSON.parse(await run(root, ["plutil", "-convert", "json", "-o", "-", path.join(custom.app, "Contents/Info.plist")], { capture: true }));
  if (info.CFBundleURLTypes?.[0]?.CFBundleURLSchemes?.[0] !== "spark-sdk-test" || info.CFBundleDocumentTypes?.[0]?.LSItemContentTypes?.[0] !== "public.plain-text" || info.NSSupportsSuddenTermination !== false)
    throw new Error("CNG did not generate URL/document/lifecycle configuration");
  console.log("PASS [custom] CNG URL/document/lifecycle configuration embedded in app");
  // Restart Metro after installing a previously absent native package.
  await restartMetro();
  await executeUI(custom.app);
  writeJson(path.join(reportDir, "summary.json"), { passed: true, go: go.runtime, custom: custom.runtime, preview: preview.runtime, isolation: { first: first.dataDirectory, second: second.dataDirectory, resumed: resumed.dataDirectory } });
  console.log(`Native suite passed. Reports: ${reportDir}`);
} finally {
  appProcess?.kill(); metro.kill(); await metro.exited;
  writeFileSync(path.join(root, "App.tsx"), originalApp);
  writeFileSync(configFile, originalConfig); prepareConfig(root);
}
