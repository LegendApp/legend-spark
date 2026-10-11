// Verifies the #103 file APIs in the real Kitchen Sink (macOS). No screenshots: results come from
// the app's JSON report plus filesystem evidence, and are written to results.json beside this file.
//   build:  ~/Development/.ks-gate/bin/ks-lock native bun e2e/verification/103/verify.ts build
//   run:    ~/Development/.ks-gate/bin/ks-lock gui bun e2e/verification/103/verify.ts run
// Launch 1 creates a bookmark, writes to read-only/full volumes and opens the sample with a
// background-only helper app. The harness then moves the bookmark target while the app is not
// running. Launch 2 restores the bookmark after relaunch and shows Quick Look (which activates the app).
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { spawnProcess, processLog } from "../../../packages/cli/src/process.ts";
import { build } from "../../../packages/cli/src/build.ts";
import { availablePort } from "../../../packages/cli/src/local.ts";
import { binary } from "../../../packages/cli/src/commands.ts";
import { projectEnvironment } from "../../../packages/cli/src/project.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const root = path.join(repo, "examples/kitchen-sink");
const work = path.join(repo, ".spark/file-api-tests");
const appPath = path.join(work, "FileAPITests.app");
const helper = path.join(work, "OpenWithProbe.app");
const sh = (command: string, args: string[]) => execFileSync(command, args, { encoding: "utf8" });
mkdirSync(work, { recursive: true });

if (process.argv[2] === "build") {
  const source = (await build(root, "dev")).app;
  rmSync(appPath, { recursive: true, force: true }); cpSync(source, appPath, { recursive: true });
  // Background-only (never activates), no document types (never becomes a registered handler).
  // It records each file it is asked to open as <file>.opened and quits.
  rmSync(helper, { recursive: true, force: true }); mkdirSync(path.join(helper, "Contents/MacOS"), { recursive: true });
  writeFileSync(path.join(helper, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>so.legend.spark.tests.open-with-probe</string><key>CFBundleExecutable</key><string>OpenWithProbe</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>`);
  const probe = path.join(work, "OpenWithProbe.swift");
  writeFileSync(probe, `import AppKit
final class Delegate: NSObject, NSApplicationDelegate {
  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls { try? url.path.write(toFile: url.path + ".opened", atomically: true, encoding: .utf8) }
    NSApp.terminate(nil)
  }
}
let delegate = Delegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
`);
  sh("swiftc", ["-O", probe, "-o", path.join(helper, "Contents/MacOS/OpenWithProbe")]);
  sh("codesign", ["--force", "--sign", "-", helper]);
  console.log(`Built ${appPath} and ${helper}`);
  process.exit(0);
}
if (process.argv[2] !== "run") throw new Error("Usage: verify.ts build|run");
if (!existsSync(appPath) || !existsSync(helper)) throw new Error("Run the build step first");

// e2e/fixtures/volumes/files-full.dmg is a compressed, completely full HFS+ image:
// attached plainly it is read-only; attached with a shadow file it is writable but full.
const fixture = path.join(repo, "e2e/fixtures/volumes/files-full.dmg");
function volume(name: string, shadow: boolean) {
  const mount = path.join(work, `mnt-${name}`), shadowFile = path.join(work, `${name}.shadow`);
  try { sh("hdiutil", ["detach", mount, "-force"]); } catch {}
  rmSync(shadowFile, { force: true }); mkdirSync(mount, { recursive: true });
  sh("hdiutil", ["attach", fixture, "-mountpoint", mount, "-nobrowse", ...(shadow ? ["-shadow", shadowFile] : [])]);
  return mount;
}
const port = await availablePort();
const metroLog = processLog(path.join(work, "metro.log"));
const metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1", SPARK_PLATFORM: "macos" }, stdout: metroLog, stderr: metroLog });
const executable = sh("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleExecutable", path.join(appPath, "Contents/Info.plist")]).trim();
type Check = { id: string; passed: boolean; detail: string };
type Report = { passed: boolean; error?: string; checks?: Check[]; samplePath?: string; bookmarkTarget?: string; restored?: string };
const runs: Record<string, Report & { evidence?: Record<string, unknown> }> = {};
const mounts: string[] = [];

async function launch(name: string, args: string[]): Promise<Report> {
  const report = path.join(work, `${name}.json`); rmSync(report, { force: true });
  const log = processLog(path.join(work, `${name}.log`));
  const app = spawnProcess([path.join(appPath, "Contents/MacOS", executable), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-files-api-report", report, ...args],
    { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: log, stderr: log });
  try {
    const end = Date.now() + 120000;
    while (!existsSync(report)) { if (Date.now() > end || app.exitCode !== null) throw new Error(`${name} did not report; see ${work}`); await sleep(250); }
    return runs[name] = JSON.parse(readFileSync(report, "utf8"));
  } finally { app.kill(); await app.exited; }
}
async function waitFor(file: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (!existsSync(file)) { if (Date.now() > end) return false; await sleep(250); }
  return true;
}
try {
  const deadline = Date.now() + 90000;
  while (!await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) { if (Date.now() > deadline) throw new Error("Metro did not start"); await sleep(250); }
  const readOnly = volume("SparkReadOnly", false); mounts.push(readOnly);
  const full = volume("SparkFull", true); mounts.push(full);
  const volumes = ["--spark-files-readonly", readOnly, "--spark-files-full", full];

  const created = await launch("create", ["--spark-files-api-phase", "create", "--spark-files-api-open-with", helper, ...volumes]);
  const opened = `${created.samplePath}.opened`;
  const openedBy = await waitFor(opened, 15000) ? readFileSync(opened, "utf8") : undefined;
  runs.create.evidence = { openWithProbeReceived: openedBy ?? null };
  if (!created.bookmarkTarget || !existsSync(created.bookmarkTarget)) throw new Error("Bookmark target was not created");
  // Move the bookmarked file while the app is not running, then relaunch.
  renameSync(created.bookmarkTarget, created.bookmarkTarget.replace("bookmark-target.txt", "bookmark-target-moved.txt"));
  await launch("relaunch", ["--spark-files-api-phase", "restore", "--spark-files-api-quick-look", ...volumes]);
} finally {
  metro.kill(); await metro.exited;
  for (const mount of mounts) try { sh("hdiutil", ["detach", mount, "-force"]); } catch {}
  try { sh("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", helper]); } catch {}
  const environment = { macOS: sh("sw_vers", ["-productVersion"]).trim(), commit: sh("git", ["-C", repo, "rev-parse", "--short", "HEAD"]).trim(), dirty: sh("git", ["-C", repo, "status", "--porcelain"]).trim().length > 0, ranAt: new Date().toISOString() };
  writeFileSync(path.join(import.meta.dirname, "results.json"), JSON.stringify({ environment, runs }, null, 2) + "\n");
}
const failed = Object.entries(runs).flatMap(([run, result]) => (result.checks ?? [{ id: "report", passed: false, detail: result.error ?? "no checks" }])
  .filter(check => !check.passed).map(check => `${run} ${check.id}: ${check.detail}`));
if (!runs.create?.evidence?.openWithProbeReceived) failed.push("create FILE-OPENWITH-01: the probe app never received the sample");
console.log(failed.length ? `FAILED\n${failed.join("\n")}` : "All file API checks passed");
if (failed.length) process.exit(1);
