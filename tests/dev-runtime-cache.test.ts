import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const file = path.resolve(import.meta.dirname, "../packages/cli/src/dev.ts");
const require = createRequire(file);
const source = readFileSync(file, "utf8").replaceAll("import.meta.url", JSON.stringify(new URL(`file://${file}`).href))
  .replaceAll("import.meta.dirname", JSON.stringify(path.dirname(file)));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
afterEach(() => vi.useRealTimers());

function session(startupFailure = false) {
  let stamp = "one";
  const inputs = { native: [], development: undefined as { fingerprint: string } | undefined };
  const cache = { read: vi.fn(() => inputs), invalidate: vi.fn(() => { inputs.development = undefined; }), close: vi.fn() };
  const watcher = { close: vi.fn() };
  const runtime = { mode: "dev", fingerprint: "runtime", modules: {} };
  const runtimeFor = vi.fn(() => runtime);
  const prepareConfig = vi.fn(() => { if (startupFailure) throw new Error("startup stopped"); });
  const modules: Record<string, unknown> = {
    "./runtime-input-cache.ts": { createRuntimeInputCache: () => cache },
    "./native-patch-preflight.ts": { assertNativePatchPreflight() {} },
    "./platform.ts": { projectPlatform: () => "macos", architecture: () => "arm64" },
    "./project.ts": {
      dependencyStamp: () => stamp, stateFile: (_root: string, name: string) => `/fixture/.spark/${name}`,
      prepareConfig, writeJson() {}, readJson: (file: string) => file.endsWith("dev-build.json") ? { app: "/runtime.app" } : { target: "dev" },
      readAppConfig: () => ({}), incompatible: () => [], nativePackages: () => [], runtimeFor,
    },
    "./local.ts": { registerRuntime() {}, readRuntime: () => runtime },
    "./release.ts": { installedRelease() {} },
    "./runner-install.ts": {}, "./build.ts": {},
    "./watchman.ts": { watchmanStalls: async () => false },
    "./session-status.ts": { sessionStatus: () => ({ compatible: true, message: "Ready", canBuild: true }) },
    "./commands.ts": { cancelCommands() {} },
    "./windows-metro.ts": { stopWindowsMetro() {} },
    "node:module": { createRequire: () => () => ({ preparePatch() {} }) },
    "node:fs": { existsSync: () => true, rmSync() {}, watch: () => watcher },
    "./process.ts": {
      nodeCommand: () => ["node", "expo"],
      spawnProcess: (_args: string[], options: any) => {
        let finish!: (code: number) => void;
        const child = { exitCode: null as number | null, exited: new Promise<number>(resolve => { finish = resolve; }),
          send() {}, kill() { child.exitCode = 0; finish(0); } };
        queueMicrotask(() => options.ipc({ type: "spark:ready", port: 9123 }, child));
        return child;
      },
    },
  };
  const module = { exports: {} as { dev: (...args: any[]) => Promise<void> } };
  Function("require", "module", "exports", code)((name: string) => modules[name] ?? require(name), module, module.exports);
  return { dev: module.exports.dev, cache, watcher, runtimeFor, prepareConfig, changeStamp() { stamp = "two"; } };
}

test("startup failure closes the runtime cache, directory watcher, timer and signal handlers", async () => {
  vi.useFakeTimers();
  const f = session(true), signals = process.listenerCount("SIGINT");
  await expect(f.dev("/fixture", undefined, [], true)).rejects.toThrow("startup stopped");
  expect(f.cache.read).toHaveBeenCalledOnce();
  expect(f.cache.close).toHaveBeenCalledOnce();
  expect(f.watcher.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(process.listenerCount("SIGINT")).toBe(signals);
});

test("refresh reuses the development fingerprint and invalidates before checking a changed stamp", async () => {
  vi.useFakeTimers();
  const f = session(), signals = process.listenerCount("SIGTERM");
  const running = f.dev("/fixture", undefined, [], true);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(f.runtimeFor).toHaveBeenCalledOnce();
    const startupReads = f.cache.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.cache.read).toHaveBeenCalledTimes(startupReads + 1);
    expect(f.runtimeFor).toHaveBeenCalledOnce();
    expect(f.cache.invalidate).not.toHaveBeenCalled();
    f.changeStamp();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.cache.invalidate).toHaveBeenCalledOnce();
    expect(f.runtimeFor).toHaveBeenCalledTimes(2);
    expect(f.cache.invalidate.mock.invocationCallOrder[0]).toBeLessThan(f.cache.read.mock.invocationCallOrder[startupReads + 1]!);
  } finally {
    // Invoke only this session's handler; do not signal other processes or sessions.
    const close = process.listeners("SIGTERM").at(-1)!;
    close("SIGTERM");
    await running;
  }
  expect(f.cache.close).toHaveBeenCalledOnce();
  expect(f.watcher.close).toHaveBeenCalledOnce();
  expect(process.listenerCount("SIGTERM")).toBe(signals);
  expect(vi.getTimerCount()).toBe(0);
});
