import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { availablePort, findGo } from "../packages/cli/src/local.ts";
import { readJson, writeJson, prepareConfig, projectEnvironment, nativePackages, incompatible } from "../packages/cli/src/project.ts";
import { runtimeTestArgs } from "./runtime-test-args.ts";

const framework = path.resolve(import.meta.dirname, "..");
const args = runtimeTestArgs(process.argv.slice(2), ".spark/runtimes-probe/SparkRuntimesProbe");
const root = path.resolve(args.root);
const packageManifest = args.packageManifest && path.resolve(args.packageManifest);
const mode = process.argv.includes("--release") ? "release" : "dev";
const prepareOnly = process.argv.includes("--prepare-only");
await prepareKitchenSink(root, packageManifest);
cpSync(path.join(root, "App.tsx"), path.join(root, "KitchenSink.tsx"));
cpSync(path.join(framework, "examples/runtimes"), root, { recursive: true });
const directory = path.join(root, ".spark/runtimes-proof"); mkdirSync(directory, { recursive: true });
const pkg = readJson(path.join(root, "package.json"));
pkg.dependencies["@react-native-runtimes/core"] = pkg.overrides["@react-native-runtimes/core"];
delete pkg.dependencies["react-native-nitro-modules"];
pkg.dependencies["fast-json-stable-stringify"] = "2.1.0";
writeJson(path.join(root, "package.json"), pkg);
await run(root, managerCommand(packageManager(root), ["install"]));
const config = readJson(path.join(root, "desktop.config.json"));
if (config.expo?.plugins) config.expo.plugins = config.expo.plugins.filter((p: string) => p !== "./runtimes.plugin.cjs");
writeJson(path.join(root, "desktop.config.json"), config); prepareConfig(root);
writeJson(path.join(root, "tsconfig.json"), { extends: "expo/tsconfig.base", compilerOptions: { strict: true, skipLibCheck: true }, include: ["App.tsx", "tasks.ts", "index.ts", "KitchenSink.tsx", "*.tsx", "*.ts"], exclude: ["node_modules"] });
if (prepareOnly) { console.log(`Prepared ${root}`); process.exit(0); }
const prebuilt = process.argv.includes("--prebuilt") || process.argv.includes("--go");
const result = prebuilt ? findGo(nativePackages(root)) : await build(root, mode, process.argv.includes("--force"));
if (!result || (prebuilt && incompatible(result.runtime, nativePackages(root)).length)) throw new Error("Build a compatible Spark Runner with spark sdk build-runner first.");
const port = await availablePort();
const report = path.join(directory, `${prebuilt ? "go" : mode}.json`); rmSync(report, { force: true });
rmSync(`${report}.before-reload`, { force: true });
let metro: ReturnType<typeof spawnProcess> | undefined;
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  if (mode === "dev") {
    writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "test", port });
    const log = processLog(path.join(directory, "metro.log"));
    metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) { ready = true; break; }
      if (metro.exitCode !== null) throw new Error("Metro exited");
      await sleep(500);
    }
    if (!ready) throw new Error("Metro startup timed out");
  }
  const executable = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(result.app, "Contents/Info.plist")], { capture: true })).trim();
  const log = processLog(path.join(directory, `${mode}.log`));
  app = spawnProcess([path.join(result.app, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-runtimes-report", report, ...(mode === "dev" ? ["--spark-runtimes-reload"] : [])], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log });
  if (process.argv.includes("--interactive")) {
    process.once("SIGINT", () => app?.kill());
    process.once("SIGTERM", () => app?.kill());
  }
  const deadline = Date.now() + 120000;
  while (!existsSync(report) && Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null) throw new Error(`App exited before report; see ${directory}`);
    await sleep(200);
  }
  if (!existsSync(report)) throw new Error(`Runtime proof timed out; see ${directory}`);
  const outcome = readJson(report);
  for (const item of outcome.results) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}: ${JSON.stringify(item.detail ?? item.error)}`);
  if (!outcome.passed) throw new Error(`Runtimes proof failed: ${report}`);
  console.log(`Runtimes ${mode} proof passed: ${report}`);
  if (process.argv.includes("--interactive")) {
    console.log(`Interactive app PID ${app.pid}; press Ctrl+C to close the prototype and its Metro server.`);
    await app.exited;
  }
} finally {
  if (app) { app.kill(); await app.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  rmSync(path.join(root, ".spark/session.json"), { force: true });
}
