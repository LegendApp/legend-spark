import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { which } from "../packages/cli/src/process.ts";

const { supported, selectRuntime, runtimeEnvironment } = createRequire(import.meta.url)("../packages/cli/src/js-runtime.cjs");
test("runtime compatibility checks the actual engine, including Bun's emulated Node version", () => {
  expect(supported({ node: "24.19.0" })).toBe(true);
  expect(supported({ node: "24.18.9" })).toBe(false);
  expect(supported({ node: "22.0.0", bun: "1.3.14" })).toBe(true);
  expect(supported({ node: "99.0.0", bun: "1.3.13" })).toBe(false);
  expect(supported({ node: "24.19.0-nightly" })).toBe(false);
});

test.each(["node", "bun"].filter(name => which(name)))("selects %s with only that runtime available and supplies upstream node commands", name => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runtime-"));
  try {
    const bin = path.join(root, "bin"); mkdirSync(bin);
    const executable = which(name)!;
    symlinkSync(executable, path.join(bin, name + (process.platform === "win32" ? ".exe" : "")));
    const env = { ...process.env, PATH: bin, SPARK_JS_RUNTIME: "", SPARK_HOME: path.join(root, "home") };
    const runtime = selectRuntime(env, path.join(root, "missing"));
    expect(runtime.name).toBe(name);
    const childEnv = runtimeEnvironment(runtime, env);
    expect(childEnv.NODE_BINARY).toBe(runtime.executable);
    const child = spawnSync(which("node", childEnv)!, ["-p", "process.versions.bun ? 'bun' : 'node'"], { env: childEnv, encoding: "utf8" });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe(name);
    expect(runtimeEnvironment(runtime, env).PATH).toBe(childEnv.PATH);
    expect(env.PATH).toBe(bin);
    if (name === "bun") expect(() => selectRuntime({ ...childEnv, SPARK_JS_RUNTIME: "node" }, "/missing/runtime")).toThrow("Requested JavaScript runtime");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an explicit missing runtime fails instead of silently changing engines", () => {
  expect(() => selectRuntime({ PATH: "", SPARK_JS_RUNTIME: "/missing/runtime" })).toThrow("Requested JavaScript runtime");
  expect(() => selectRuntime({ PATH: "" }, "/missing/runtime")).toThrow("No compatible JavaScript runtime");
});

test.skipIf(process.platform === "win32")("an unsupported Node on PATH falls back to Bun", () => {
  const bun = which("bun");
  if (!bun) return;
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runtime-old-"));
  try {
    writeFileSync(path.join(root, "node"), '#!/bin/sh\nprintf \'{"node":"18.0.0"}\\n\'\n', { mode: 0o755 });
    symlinkSync(bun, path.join(root, "bun"));
    expect(selectRuntime({ PATH: root }, path.join(root, "node")).name).toBe("bun");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
