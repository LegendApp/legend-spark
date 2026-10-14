import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { spawnProcess, which } from "../packages/cli/src/process.ts";
import { linkCommand, runtimeFixture, runtimes } from "./helpers/js-runtimes.ts";

const { supported, selectRuntime, runtimeEnvironment } = createRequire(import.meta.url)("../packages/cli/src/js-runtime.cjs");
const both = test.skipIf(runtimes.length !== 2);

both("Bun wins automatic selection even when launched by Node; explicit choices win over the default", () => {
  const fixture = runtimeFixture(["node", "bun"]);
  try {
    const node = runtimes.find(runtime => runtime.name === "node")!.executable;
    expect(selectRuntime(fixture.env, node).name).toBe("bun");
    for (const runtime of runtimes) {
      expect(selectRuntime({ ...fixture.env, SPARK_JS_RUNTIME: runtime.name }, node).name).toBe(runtime.name);
      expect(selectRuntime({ ...fixture.env, SPARK_JS_RUNTIME: runtime.executable }, node).name).toBe(runtime.name);
    }
  } finally { fixture.dispose(); }
});

both.each(runtimes.flatMap(runtime => ["", "node", "bun"].map(requested => ({ ...runtime, requested }))))("$name initialization preserves arguments, child engine, and exit status with override '$requested'", ({ executable, requested }) => {
  const fixture = runtimeFixture(["node", "bun"]);
  try {
    const entry = path.join(fixture.root, "initialize.cjs");
    const helper = path.resolve(import.meta.dirname, "../packages/cli/src/js-runtime.cjs");
    writeFileSync(entry, `require(${JSON.stringify(helper)}).initializeRuntime().then(runtime => {
      const child = require('node:child_process').spawnSync('node', ['-p', "process.versions.bun ? 'bun' : 'node'"], {encoding:'utf8'});
      if (child.status !== 0) throw new Error(child.stderr);
      console.log(JSON.stringify({engine:runtime.name, child:child.stdout.trim(), args:process.argv.slice(2)}));
      process.exitCode = 23;
    });`);
    const result = spawnSync(executable, [entry, "two words", "$(literal)"], {
      env: { ...fixture.env, SPARK_JS_RUNTIME: requested }, encoding: "utf8", timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(23);
    expect(JSON.parse(result.stdout)).toEqual({ engine: requested || "bun", child: requested || "bun", args: ["two words", "$(literal)"] });
  } finally { fixture.dispose(); }
});

test.skipIf(process.platform === "win32" || runtimes.length !== 2)("the launcher forwards shutdown to the selected Bun process", async () => {
  const fixture = runtimeFixture(["node", "bun"]);
  const entry = path.join(fixture.root, "shutdown.cjs");
  const helper = path.resolve(import.meta.dirname, "../packages/cli/src/js-runtime.cjs");
  writeFileSync(entry, `require(${JSON.stringify(helper)}).initializeRuntime().then(runtime => {
    process.on('SIGTERM', () => process.exit(27));
    setTimeout(() => process.exit(99), 5000);
    console.log('ready:' + runtime.name);
  });`);
  const child = spawnProcess([runtimes.find(runtime => runtime.name === "node")!.executable, entry], { env: fixture.env });
  try {
    const reader = child.stdout!.getReader();
    let output = "";
    while (!output.includes("ready:bun")) {
      const next = await reader.read();
      if (next.done) throw new Error(`Child stopped before ready: ${output}`);
      output += new TextDecoder().decode(next.value);
    }
    reader.releaseLock();
    child.kill("SIGTERM");
    expect(await child.exited).toBe(27);
  } finally { if (child.exitCode === null) child.kill(); fixture.dispose(); }
}, 10_000);

test.skipIf(process.platform === "win32" || !runtimes.some(runtime => runtime.name === "node"))("unsupported Bun falls back to Node", () => {
  const fixture = runtimeFixture(["node"]);
  try {
    writeFileSync(path.join(fixture.bin, "bun"), '#!/bin/sh\nprintf \'{"node":"99.0.0","bun":"1.0.0"}\\n\'\n', { mode: 0o755 });
    expect(selectRuntime(fixture.env, "/missing/runtime").name).toBe("node");
    expect(() => selectRuntime({ ...fixture.env, SPARK_JS_RUNTIME: "bun" })).toThrow("Requested JavaScript runtime");
  } finally { fixture.dispose(); }
});
test("runtime compatibility checks the actual engine, including Bun's emulated Node version", () => {
  expect(supported({ node: "24.19.0" })).toBe(true);
  expect(supported({ node: "24.18.9" })).toBe(false);
  expect(supported({ node: "22.0.0", bun: "1.3.14" })).toBe(true);
  expect(supported({ node: "99.0.0", bun: "1.3.13" })).toBe(false);
  expect(supported({ node: "24.19.0-nightly" })).toBe(false);
});

test.each(runtimes)("selects $name with only that runtime available and supplies upstream node commands", ({ name }) => {
  const fixture = runtimeFixture([name]);
  const { root, bin, env } = fixture;
  try {
    const runtime = selectRuntime(env, path.join(root, "missing"));
    expect(runtime.name).toBe(name);
    const childEnv = runtimeEnvironment(runtime, env);
    expect(childEnv.NODE_BINARY).toBe(runtime.executable);
    const child = spawnSync(which("node", childEnv)!, ["-p", "process.versions.bun ? 'bun' : 'node'"], { env: childEnv, encoding: "utf8" });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe(name);
    expect(runtimeEnvironment(runtime, env).PATH).toBe(childEnv.PATH);
    expect(runtimeEnvironment(runtime, childEnv).PATH).toBe(childEnv.PATH);
    expect(env.PATH).toBe(bin);
    if (name === "bun") expect(() => selectRuntime({ ...childEnv, SPARK_JS_RUNTIME: "node" }, "/missing/runtime")).toThrow("Requested JavaScript runtime");
  } finally { fixture.dispose(); }
});

test("an explicit missing runtime fails instead of silently changing engines", () => {
  expect(() => selectRuntime({ PATH: "", SPARK_JS_RUNTIME: "/missing/runtime" })).toThrow("Requested JavaScript runtime");
  expect(() => selectRuntime({ PATH: "" }, "/missing/runtime")).toThrow("No compatible JavaScript runtime");
});

test.skipIf(process.platform === "win32")("an unsupported Node on PATH falls back to Bun", () => {
  const bun = runtimes.find(runtime => runtime.name === "bun")?.executable;
  if (!bun) return;
  const fixture = runtimeFixture();
  const root = fixture.bin;
  try {
    writeFileSync(path.join(root, "node"), '#!/bin/sh\nprintf \'{"node":"18.0.0"}\\n\'\n', { mode: 0o755 });
    linkCommand(bun, root, "bun");
    expect(selectRuntime({ PATH: root }, path.join(root, "node")).name).toBe("bun");
  } finally { fixture.dispose(); }
});
