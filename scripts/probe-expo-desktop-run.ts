import { spawnProcess, processLog } from "../packages/cli/src/process.ts";
// Integration boundary probe: real upstream CLI + prebuilt binary, with OS launch
// intercepted so the probe never starts an app or terminates another session.
import { cpSync, readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { nodeCommand } from "../packages/cli/src/windows.ts";
import { availablePort } from "../packages/cli/src/local.ts";
const framework = path.resolve(import.meta.dirname, "..");
const binary = path.resolve(process.argv[2] ?? "examples/kitchen-sink/.spark/platforms/macos/products/dev/KitchenSink.app");
if (process.platform !== "darwin" || !existsSync(binary)) throw new Error("Run on macOS with an existing Kitchen Sink .app (or pass its path).");
const parent = mkdtempSync(path.join(os.tmpdir(), "spark-upstream-run-"));
const root = path.join(parent, "BinaryProbe"), shims = path.join(parent, "bin");
mkdirSync(root); mkdirSync(shims);
const output = path.join(framework, ".spark/expo-desktop-run-probe"); mkdirSync(output, { recursive: true });
const record = path.join(output, "launch.json"); rmSync(record, { force: true });
writeFileSync(path.join(root, "package.json"), readFileSync(path.join(framework, "examples/kitchen-sink/package.json")));
writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "BinaryProbe", slug: "binary-probe", platforms: ["macos"], macos: { bundleIdentifier: "org.spark.binaryprobe" } } }));
writeFileSync(path.join(root, "index.js"), "// Binary launch should not need native project generation.\n");
symlinkSync(path.join(framework, "node_modules"), path.join(root, "node_modules"));
writeFileSync(path.join(shims, "open"), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.SPARK_PROBE_RECORD, JSON.stringify({args:process.argv.slice(2)}));\n', { mode: 0o755 });
// Avoid upstream's bundle-ID-wide termination during a diagnostic run.
writeFileSync(path.join(shims, "osascript"), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const results: object[] = [];
for (const phase of ["javascript-only", "existing-project"] as const) {
  if (phase === "existing-project") {
    rmSync(path.join(root, "macos"), { recursive: true, force: true }); mkdirSync(path.join(root, "macos"));
    const native = path.join(framework, "examples/kitchen-sink/macos");
    for (const name of readdirSync(native).filter(name => /\.xc(workspace|proj)$/.test(name))) cpSync(path.join(native, name), path.join(root, "macos", name), { recursive: true });
  }
  rmSync(record, { force: true });
  const logPath = path.join(output, `${phase}.log`);
  rmSync(logPath, { force: true });
  const log = processLog(logPath);
  const port = await availablePort();
  const args = nodeCommand(root, "expo-desktop", "expo-desktop", ["run", "macos", root, "--binary", binary, "--no-install", "--no-bundler", "--no-single-instance"]);
  const child = spawnProcess(args, { cwd: root, detached: true, env: { ...process.env, CI: "1", RCT_METRO_PORT: String(port), EXPO_NO_GIT_STATUS: "1", SPARK_PROBE_RECORD: record,
    PATH: [shims, path.join(framework, "packages/cli/src/npm-bin"), process.env.PATH].join(path.delimiter) }, stdout: log, stderr: log });
  const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch {} };
  const timer = setTimeout(stop, 60_000);
  const launched = setInterval(() => { if (existsSync(record)) stop(); }, 100);
  try {
    const exitCode = await child.exited;
    results.push({ phase, exitCode, requestedMetroPort: port, nativeProjectCreated: existsSync(path.join(root, "macos")),
      launch: existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : null });
  } finally { clearTimeout(timer); clearInterval(launched); stop(); }
}
const report = { version: JSON.parse(readFileSync(path.join(framework, "node_modules/expo-desktop/package.json"), "utf8")).version,
  results, note: "Real upstream CLI; open/osascript intercepted. Existing-project phase copies Xcode metadata only. This checks orchestration, not native app launch.", root };
writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
