import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareKitchenSink } from "./prepare-kitchen-sink.ts";
import { build } from "../packages/cli/src/build.ts";
import { availablePort } from "../packages/cli/src/local.ts";
import { binary, run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson, projectEnvironment, prepareConfig, readAppConfig } from "../packages/cli/src/project.ts";
const root = path.resolve(process.argv[2] ?? ".spark/expansion-tests/Expansion");
await prepareKitchenSink(root);
const canonical = path.join(root, "desktop.config.json"), generated = path.join(root, "app.json");
const originalCanonical = existsSync(canonical) ? readFileSync(canonical) : undefined;
const originalGenerated = existsSync(generated) ? readFileSync(generated) : undefined;
const previous = readAppConfig(root).expo;
const port = await availablePort();
const directory = path.join(root, ".spark/expansion-results"); mkdirSync(directory, { recursive: true });
writeJson(path.join(root, ".spark/session.json"), { compatible: true, target: "test", port });
let metro: ReturnType<typeof spawnProcess> | undefined;
let app: ReturnType<typeof spawnProcess> | undefined;
try {
  writeJson(canonical, { name: previous.name, version: previous.version, projectId: previous.extra?.spark?.projectId ?? previous.macos?.bundleIdentifier,
    macos: previous.macos, window: { title: "Configured main", size: { width: 930, height: 620 }, minSize: { width: 400, height: 100 }, maxSize: { width: 1400, height: 20000 }, resizable: false, titleBarStyle: "overlay", restoreBounds: false } });
  prepareConfig(root);
  const log = processLog(path.join(directory, "metro.log"));
  metro = spawnProcess([binary(root, "expo"), "start", "--localhost", "--port", String(port), "--max-workers", "2"], { cwd: root, env: { ...process.env, CI: "1" }, stdout: log, stderr: log });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) { ready = true; break; }
    if (metro.exitCode !== null) throw new Error("Metro exited during startup");
    await sleep(500);
  }
  if (!ready) throw new Error("Metro startup timed out");
  for (const mode of ["dev", "go"] as const) {
    const pkgFile = path.join(root, "package.json"), pkg = readJson(pkgFile);
    if (mode === "dev") pkg.dependencies["@legendapp/spark-sdk-test-driver"] = `file:${path.resolve(import.meta.dirname, "../fixtures/sdk-test-driver")}`;
    else delete pkg.dependencies["@legendapp/spark-sdk-test-driver"];
    writeJson(pkgFile, pkg);
    await run(root, managerCommand(packageManager(root), ["install"]));
    const result = await build(root, mode);
    const name = (await run(root, ["/usr/libexec/PlistBuddy", "-c", "Print CFBundleExecutable", path.join(result.app, "Contents/Info.plist")], { capture: true })).trim();
    const report = path.join(directory, `${mode}.json`); rmSync(report, { force: true });
    const appLog = processLog(path.join(directory, `${mode}.log`));
    app = spawnProcess([path.join(result.app, "Contents/MacOS", name), "-RCT_jsLocation", `127.0.0.1:${port}`, "--spark-expansion-report", report, "--spark-window-config-probe"], { cwd: root, env: { ...process.env, ...projectEnvironment(root), SPARK_BUNDLE_URL: `http://127.0.0.1:${port}/index.bundle?platform=macos&dev=true&minify=false` }, stdout: appLog, stderr: appLog });
    const deadline = Date.now() + 90000;
    while (!existsSync(report) && Date.now() < deadline) {
      if (app.exitCode !== null || app.signalCode !== null) throw new Error(`${mode} exited before reporting; see ${directory}`);
      await sleep(200);
    }
    if (!existsSync(report)) throw new Error(`${mode} timed out; see ${directory}`);
    const outcome = readJson(report);
    for (const item of outcome.results ?? []) console.log(`${item.passed ? "PASS" : "FAIL"} [${mode}] ${item.name}${item.error ? `: ${item.error}` : ""}`);
    if (!outcome.passed) throw new Error(`Expansion suite failed: ${JSON.stringify(outcome)}`);
    app.kill(); await app.exited; app = undefined;
  }
} finally {
  if (app) { app.kill(); await app.exited; }
  if (metro) { metro.kill(); await metro.exited; }
  const pkgFile = path.join(root, "package.json"), pkg = readJson(pkgFile);
  if (pkg.dependencies["@legendapp/spark-sdk-test-driver"]) {
    delete pkg.dependencies["@legendapp/spark-sdk-test-driver"]; writeJson(pkgFile, pkg);
    await run(root, managerCommand(packageManager(root), ["install"]));
  }
  rmSync(path.join(root, ".spark/session.json"), { force: true });
  if (originalCanonical) writeFileSync(canonical, originalCanonical); else rmSync(canonical, { force: true });
  if (originalGenerated) writeFileSync(generated, originalGenerated); else rmSync(generated, { force: true });
}
