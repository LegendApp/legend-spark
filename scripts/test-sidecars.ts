import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
// Exercise the actual React Native process module in a disposable packaged app.
// Build Kitchen Sink first with: bun run spark build --dev --project examples/kitchen-sink
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { copyHelpers } from "../packages/cli/src/helpers.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { projectEnvironment } from "../packages/cli/src/project.ts";
if (process.platform !== "darwin") throw new Error("This launcher currently runs on macOS; see docs/sidecars.md for the Windows probe.");
const root = path.resolve("examples/kitchen-sink");
const source = path.join(root, ".spark/platforms/macos/products/dev/KitchenSink.app");
if (!existsSync(source)) throw new Error("Build the Kitchen Sink macOS runtime first.");
const directory = path.resolve(".spark/sidecar-tests");
rmSync(directory, { recursive: true, force: true }); mkdirSync(path.join(directory, "binary"), { recursive: true });
await run(directory, ["cc", path.resolve("examples/sidecar/echo.c"), "-o", path.join(directory, "binary/echo")]);
await run(directory, ["cc", path.resolve("examples/sidecar/worker.c"), "-o", path.join(directory, "binary/worker")]);
const appPath = path.join(directory, "SidecarTests.app");
cpSync(source, appPath, { recursive: true });
copyHelpers(directory, appPath, { echo: { "macos-arm64": { directory: "binary", executable: "echo" } }, worker: { "macos-arm64": { directory: "binary", executable: "worker" } } });
await run(directory, ["codesign", "--force", "--deep", "--sign", "-", appPath]);
const port = await availablePort();
const report = path.join(directory, "report.json");
const metroLog = processLog(path.join(directory, "metro.log"));
const metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1", SPARK_PLATFORM: "macos" }, stdout: metroLog, stderr: metroLog });
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  const deadline = Date.now() + 60000;
  while (!await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) {
    if (Date.now() > deadline || metro.exitCode !== null) throw new Error(`Metro did not start; see ${directory}`);
    await sleep(250);
  }
  const executable = (await run(directory, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(appPath, "Contents/Info.plist")], { capture: true })).trim();
  const log = processLog(path.join(directory, "app.log"));
  app = spawnProcess([path.join(appPath, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-test-report", report, "--spark-sidecar-probe", "--spark-sidecar-quit-probe"], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log });
  const end = Date.now() + 90000;
  while (!existsSync(report)) {
    if (Date.now() > end || app.exitCode !== null) throw new Error(`Sidecar probe did not report; see ${directory}`);
    await sleep(250);
  }
  const result = JSON.parse(readFileSync(report, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) throw new Error("Sidecar probe failed");
  await Promise.race([app.exited, sleep(10000).then(() => { throw new Error("App quit timed out"); })]);
  let alive = true;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { process.kill(result.livePid, 0); } catch { alive = false; break; }
    await sleep(50);
  }
  if (alive) throw new Error(`Helper ${result.livePid} survived app quit`);
  console.log("PASS normal app quit cleaned up the live helper");
} finally {
  if (app) { app.kill(); await app.exited; }
  metro.kill(); await metro.exited;
  rmSync(appPath, { recursive: true, force: true });
}
