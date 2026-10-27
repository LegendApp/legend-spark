import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";
const root = path.resolve(process.argv[2] ?? ".spark/integration-tests/Integrations");
await prepareKitchenSink(root);
const packageFile = path.join(root, "package.json");
const pkg = readJson(packageFile);
if (pkg.dependencies["@legendapp/spark-sdk-test-driver"]) { delete pkg.dependencies["@legendapp/spark-sdk-test-driver"]; writeJson(packageFile, pkg); await run(root, managerCommand(packageManager(root), ["install"])); }
const appFile = path.join(root, "App.tsx");
const original = readFileSync(appFile, "utf8");
const report = path.join(root, ".spark/integration-report.json");
const port = await availablePort();
let metro: ReturnType<typeof spawnProcess> | undefined;
let appProcess: ReturnType<typeof spawnProcess> | undefined;
try {
  writeFileSync(appFile, `import React, { useEffect } from "react";
import { Text } from "react-native";
import { writeText } from "@legendapp/spark/files";
import { runIntegrationChecks } from "./integration-checks";
export default function App() {
  useEffect(() => { const results = []; runIntegrationChecks(async (name, action) => {
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  }).then(() => writeText(${JSON.stringify(report)}, JSON.stringify({ passed: results.every(result => result.passed), results }))).catch(error => writeText(${JSON.stringify(report)}, JSON.stringify({ passed: false, error: String(error) }))); }, []);
  return <Text>Native desktop integration checks</Text>;
}`);
  const log = processLog(path.join(root, ".spark/integration-metro.log"));
  metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...globalThis.process.env, NODE_OPTIONS: `${globalThis.process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`, CI: "1" }, stdout: log, stderr: log });
  let ready = false;
  const readyBy = Date.now() + 60000;
  while (Date.now() < readyBy) {
    if (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) { ready = true; break; }
    await sleep(100);
  }
  if (!ready) throw new Error("Metro did not become ready");
  for (const mode of ["go", "dev"] as const) {
    const result = await build(root, mode);
    const name = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(result.app, "Contents/Info.plist")], { capture: true })).trim();
    rmSync(report, { force: true });
    const appLog = processLog(path.join(root, `.spark/integrations-${mode}.log`));
    appProcess = spawnProcess([path.join(result.app, "Contents/MacOS", name), "-RCT_jsLocation", `127.0.0.1:${port}`], { cwd: root, env: { ...globalThis.process.env, SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: appLog, stderr: appLog });
    const deadline = Date.now() + 45000;
    while (!existsSync(report) && Date.now() < deadline) {
      if (appProcess.exitCode !== null || appProcess.signalCode !== null) throw new Error(`${mode} exited before reporting`);
      await sleep(100);
    }
    if (!existsSync(report)) throw new Error(`${mode} timed out; inspect ${root}/.spark/integrations-${mode}.log`);
    const outcome = readJson(report); writeJson(path.join(root, `.spark/integration-${mode}-report.json`), outcome);
    for (const check of outcome.results ?? []) console.log(`${check.passed ? "PASS" : "FAIL"} [${mode}] ${check.name}${check.error ? `: ${check.error}` : ""}`);
    if (!outcome.passed) throw new Error(`Integration suite failed: ${JSON.stringify(outcome)}`);
    appProcess.kill(); await appProcess.exited; appProcess = undefined;
  }
} finally {
  if (appProcess) { appProcess.kill(); await appProcess.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  writeFileSync(appFile, original);
}
