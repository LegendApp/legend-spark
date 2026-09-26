import { spawnProcess } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { preparePatch, VERSION } = require("../packages/cli/src/expo-dev-patch.cjs");
const { commands } = require("../packages/cli/src/expo-dev-extension.cjs");
const root = path.resolve(import.meta.dirname, "..");
const preload = path.join(root, "packages/cli/src/expo-dev-preload.cjs");

test("Metro readiness does not wait for Expo's dependency checks", async () => {
  const patches = preparePatch(root) as Map<string, string>;
  const source = [...patches].find(([file]) => file.endsWith("/startAsync.js"))![1];
  for (const serverFails of [false, true]) {
    const events: string[] = [];
    const exports: any = {};
    const modules: Record<string, unknown> = {
      "@expo/config": { getConfig: () => ({ exp: { platforms: ["macos"] }, pkg: {} }) },
      chalk: { gray: (value: string) => value },
      "../log": { log() {} },
      "../utils/profile": { profile: (fn: unknown) => fn },
      "../utils/env": { env: {} },
      "./resolveOptions": { resolvePortsAsync: async () => ({ metroPort: 19091 }) },
      "./server/platformBundlers": { getPlatformBundlers: () => ({ macos: "metro" }) },
      "./server/DevServerManager": { DevServerManager: class {
        async startAsync() { if (serverFails) throw new Error("server failed"); events.push("listening"); }
        getNativeDevServerPort() { return 19091; }
        async watchEnvironmentVariables() {}
        async bootstrapTypeScriptAsync() {}
      } },
      "./doctor/dependencies/validateDependenciesVersions": { validateDependenciesVersionsAsync: async () => {
        events.push("dependency check");
        throw new Error("dependency check failed");
      } },
    };
    new Function("require", "exports", source)((name: string) => name.endsWith("expo-dev-extension.cjs")
      ? { ready: (port: number) => { expect(port).toBe(19091); events.push("ready"); } }
      : modules[name] ?? {}, exports);
    await expect(exports.startAsync(root, { dev: true }, {})).rejects.toThrow(serverFails ? "server failed" : "dependency check failed");
    expect(events).toEqual(serverFails ? [] : ["listening", "ready", "dependency check"]);
  }
});

test("desktop keys follow host/target and leave Expo's existing shortcuts available", () => {
  for (const [target, host, label] of [["macos", "darwin", "macOS"], ["windows", "win32", "Windows"]]) {
    const go = commands(target, host, { target: "go", canBuild: false });
    expect(go.map((item: any) => item.key)).toEqual(["d", "g", "b"]);
    expect(go[0].msg).toBe(`open ${label} (Spark Runner)`);
    expect(go[0].disabled).toBe(false);
    expect(go[2].disabled).toBe(true);
    const dev = commands(target, host, { target: "dev", canBuild: true });
    expect(dev[1].msg).toContain("Spark Runner");
    expect(dev[2].disabled).toBe(false);
  }
  expect(commands("windows", "darwin").every((item: any) => item.disabled)).toBe(true);
  expect(commands("macos", "win32").every((item: any) => item.disabled)).toBe(true);
  expect(commands("ios", "darwin")).toEqual([]);
});

test("the patch rejects unsupported versions and modified upstream sources without writing installed files", () => {
  const patches = preparePatch(root) as Map<string, string>;
  const temp = mkdtempSync(path.join(os.tmpdir(), "spark-expo-patch-"));
  try {
    mkdirSync(path.join(temp, "node_modules/expo"), { recursive: true });
    writeFileSync(path.join(temp, "package.json"), "{}");
    writeFileSync(path.join(temp, "node_modules/expo/package.json"), "{}");
    const cli = path.join(temp, "node_modules/@expo/cli");
    mkdirSync(cli, { recursive: true });
    writeFileSync(path.join(cli, "package.json"), JSON.stringify({ version: "unsupported" }));
    expect(() => preparePatch(temp)).toThrow(`require @expo/cli ${VERSION}`);
    writeFileSync(path.join(cli, "package.json"), JSON.stringify({ version: VERSION }));
    for (const [file, patched] of patches) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("expo-dev-extension.cjs");
      expect(patched).toContain("expo-dev-extension.cjs");
      expect(() => new Function("require", "module", "exports", patched)).not.toThrow();
      const dest = path.join(cli, "build/src/start", file.split("/build/src/start/")[1]!);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, source);
    }
    expect(preparePatch(temp).size).toBe(3);
    writeFileSync(path.join(cli, "build/src/start/interface/commandsTable.js"), "changed upstream source");
    expect(() => preparePatch(temp)).toThrow("Unsupported Expo CLI source");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("Expo's real key handler routes desktop actions over IPC and retains reload/menu actions", async () => {
  const actions: string[] = [];
  const child = spawnProcess(["node", "--require", preload, path.join(import.meta.dirname, "fixtures/expo-dev-session.cjs")], {
    cwd: root, env: { ...process.env, SPARK_PLATFORM: "macos", FORCE_COLOR: "0" },
    stdout: "pipe", stderr: "pipe", serialization: "json",
    ipc(message, sender) {
      if (message.type === "test:ready") sender.send({ type: "spark:state", state: { target: "go", canBuild: true } });
      if (message.type === "spark:action") {
        actions.push(message.action);
        sender.send({ type: "spark:state", state: { target: "dev", canBuild: true } });
        sender.send({ type: "spark:result", id: message.id, ...(message.action === "build" ? { error: "Test build failure" } : {}) });
      }
    },
  });
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err).toBe(0);
    expect(out).toContain("open macOS (Spark Runner)");
    const [compact, rest] = out.split("VERBOSE_COMMANDS");
    const verbose = rest!.split("END_COMMANDS")[0]!;
    for (const table of [compact!, verbose]) {
      const keys = [...table.matchAll(/Press ([a-z?]) /g)].map(match => match[1]);
      expect(keys.indexOf("g")).toBe(keys.indexOf("s") + 1);
      expect(keys.indexOf("d")).toBe(keys.indexOf("w") + 1);
      expect(keys.indexOf("b")).toBe(keys.indexOf("d") + 1);
      for (const key of ["d", "g", "b"]) expect(keys.filter(item => item === key)).toHaveLength(1);
    }
    expect(out).toContain('"broadcasts":["reload","devMenu","reload"]');
    expect(out).toContain('"target":"open macOS (development build)"');
    expect(err).toContain("Test build failure");
    expect(actions).toEqual(["open", "switch", "build"]);
  } finally { if (child.exitCode === null) child.kill(); }
}, 20000);

test("Metro child processes ignore the inherited preload", async () => {
  const child = spawnProcess(["node", "--require", preload, "-e", "console.log('worker ready')"], {
    cwd: os.tmpdir(), env: { ...process.env, SPARK_EXPO_PRELOADED: "1" }, stdout: "pipe", stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toContain("worker ready");
  expect(await child.exited).toBe(0);
});
