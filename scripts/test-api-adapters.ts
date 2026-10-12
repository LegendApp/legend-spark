import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { readJson, writeJson, prepareConfig } from "../packages/cli/src/project.ts";

import { createReport, record, saveReport, installedVersions } from "./testing/report.ts";

// Focused checks run the actual kitchen-sink screen with a test-only native driver.
const root = path.resolve(process.argv[2] ?? ".spark/api-tests/KitchenSink");
await prepareKitchenSink(root);
const pkgFile = path.join(root, "package.json");
const pkg = readJson(pkgFile);
pkg.dependencies["@legendapp/spark-sdk-test-driver"] = pkg.overrides["@legendapp/spark-sdk-test-driver"];
writeJson(pkgFile, pkg);
await run(root, managerCommand(packageManager(root), ["install"]));
const configFile = path.join(root, "desktop.config.json");
const originalConfig = readFileSync(configFile, "utf8");
const configuration = readJson(configFile);
configuration.scheme = "spark-api-test";
configuration.macos = { ...configuration.macos, bundleIdentifier: "so.legend.spark.prototype.apiadapters" };
writeJson(configFile, configuration);
const directory = path.join(root, ".spark/api-results"); mkdirSync(directory, { recursive: true });
const port = await availablePort();
let metro: ReturnType<typeof spawnProcess> | undefined;
let directApp: ReturnType<typeof spawnProcess> | undefined;
let launchedPID: number | undefined;
let staging: string | undefined;
let application: string | undefined;
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
async function waitFor<T>(read: () => Promise<T | undefined>, description: string, timeout = 120000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value !== undefined) return value; await sleep(200); }
  throw new Error(`Timed out waiting for ${description}; see ${directory}`);
}
const coverage = createReport(path.resolve(import.meta.dirname, ".."), root, { platform: "macos", arch: "arm64", device: "macOS desktop", mode: "dev" }, "runtime");
const coverageFile = path.resolve(".spark/test-results", `${coverage.runId}.json`);
coverage.versions = installedVersions(root);
let coverageStage = "build.native";
saveReport(coverageFile, coverage);
try {
  const product = await build(root, "dev");
  coverage.runtime = product.runtime;
  record(coverage, { id: "build.native", status: "passed" });
  coverageStage = "runtime.launch";
  const executableName = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleExecutable", path.join(product.app, "Contents/Info.plist")], { capture: true })).trim();
  // LaunchServices excludes apps in /tmp from URL-handler lookup, even after registration.
  // A temporary user Applications copy exercises the same installed-app behavior as a consumer.
  const applications = path.join(homedir(), "Applications"); mkdirSync(applications, { recursive: true });
  staging = mkdtempSync(path.join(applications, "SparkAPIChecks-"));
  application = path.join(staging, "KitchenSink.app");
  await run(root, ["ditto", product.app, application]);
  await run(root, [lsregister, "-f", application]);
  const executable = path.join(application, "Contents/MacOS", executableName);
  writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "test", port });
  const log = processLog(path.join(directory, "metro.log"));
  metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log });
  await waitFor(async () => fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok ? true : undefined, () => undefined), "Metro", 60000);
  const bundleURL = `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false`;
  const summary: Record<string, unknown> = {};
  for (const cold of [false, true]) {
    const phase = cold ? "cold-url" : "normal-launch";
    const report = path.join(directory, `${phase}-${Date.now()}.json`);
    const initial = `spark-api-test://initial/${Date.now()}`;
    const args = ["-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-api-report", report];
    if (cold) {
      // LaunchServices delivers a real cold-open Apple event, rather than simulating it in JS.
      await run(root, ["open", "-n", "-a", application, "--env", `SPARK_BUNDLE_URL=${bundleURL}`, "--stdout", path.join(directory, `${phase}.log`), "--stderr", path.join(directory, `${phase}.log`), initial, "--args", ...args, "--spark-api-initial", initial]);
      const listing = await run(root, ["ps", "-axo", "pid=,command="], { capture: true });
      const owned = listing.split("\n").find(line => line.includes(executable) && line.includes(report));
      if (owned) launchedPID = Number(owned.trim().split(/\s+/)[0]);
    } else {
      const output = processLog(path.join(directory, `${phase}.log`));
      directApp = spawnProcess([executable, ...args], { cwd: root, env: { ...process.env, SPARK_BUNDLE_URL: bundleURL }, stdout: output, stderr: output });
    }
    const outcome = await waitFor(async () => existsSync(report) ? readJson(report) : undefined, phase);
    for (const check of outcome.results ?? []) console.log(`${check.passed ? "PASS" : "FAIL"} [${phase}] ${check.name}${check.error ? `: ${check.error}` : ""}`);
    for (const check of outcome.results ?? []) for (const id of check.contracts ?? []) {
      if (coverage.results.find(result => result.id === id)?.status !== "failed") record(coverage, { id, status: check.passed ? "passed" : "failed", detail: check.error, durationMs: check.duration, evidence: report });
    }
    saveReport(coverageFile, coverage);
    if (!outcome.passed || !outcome.nativeDriver || outcome.results.length !== 6) throw new Error(`Kitchen-sink API checks failed: ${report}`);
    record(coverage, { id: "runtime.launch", status: "passed", evidence: report });
    summary[phase] = { report, ...outcome };
    if (directApp) { await directApp.exited; directApp = undefined; }
    if (launchedPID) {
      const pid = launchedPID;
      await waitFor(async () => { try { process.kill(pid, 0); return undefined; } catch { return true; } }, "test application quit", 15000);
      launchedPID = undefined;
    }
  }
  writeJson(path.join(directory, "summary.json"), { passed: true, ...summary });
  console.log(`Kitchen-sink API validation passed: ${directory}`);
} catch (error) {
  coverage.execution = "failed"; coverage.error = String(error);
  record(coverage, { id: coverageStage, status: "failed", detail: String(error) });
  throw error;
} finally {
  if (coverage.execution === "running") coverage.execution = "completed";
  coverage.finishedAt = new Date().toISOString(); saveReport(coverageFile, coverage);
  console.log(`Platform coverage: ${coverageFile}`);
  if (directApp && directApp.exitCode === null) { directApp.kill(); await directApp.exited; }
  if (launchedPID) { try { process.kill(launchedPID, "SIGTERM"); } catch {} }
  if (metro) { metro.kill(); await metro.exited; }
  if (application) await run(root, [lsregister, "-u", application]);
  if (staging) rmSync(staging, { recursive: true });
  writeFileSync(configFile, originalConfig); prepareConfig(root);
}
