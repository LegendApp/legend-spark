import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
// Build Kitchen Sink and exercise native streaming handles and OS recycling.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "../packages/cli/src/build.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { projectEnvironment } from "../packages/cli/src/project.ts";
if (process.platform !== "darwin") throw new Error("This launcher builds the AppKit test driver on macOS. Run the portable Kitchen Sink checks on Windows.");
const root = path.resolve("examples/kitchen-sink");
const directory = path.resolve(".spark/file-stream-tests");
mkdirSync(directory, { recursive: true });
const source = (await build(root, "dev")).app;
const appPath = path.join(directory, "FileStreamTests.app");
rmSync(appPath, { recursive: true, force: true }); cpSync(source, appPath, { recursive: true });
const port = await availablePort();
const report = path.join(directory, "report.json"); rmSync(report, { force: true });
const metroLog = processLog(path.join(directory, "metro.log"));
const metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`, CI: "1", SPARK_PLATFORM: "macos" }, stdout: metroLog, stderr: metroLog });
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  const deadline = Date.now() + 60000;
  while (!await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) {
    if (Date.now() > deadline || metro.exitCode !== null) throw new Error(`Metro did not start; see ${directory}`);
    await sleep(250);
  }
  const executable = (await run(directory, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(appPath, "Contents/Info.plist")], { capture: true })).trim();
  const log = processLog(path.join(directory, "app.log"));
  app = spawnProcess([path.join(appPath, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-files-report", report], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log });
  const end = Date.now() + 90000;
  while (!existsSync(report)) {
    if (Date.now() > end || app.exitCode !== null) throw new Error(`File stream probe did not report; see ${directory}`);
    await sleep(250);
  }
  const result = JSON.parse(readFileSync(report, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) throw new Error("File stream probe failed");
} finally {
  if (app) { app.kill(); await app.exited; }
  metro.kill(); await metro.exited;
  rmSync(appPath, { recursive: true, force: true });
}
