import { afterEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { createRuntimeInputCache } from "../packages/cli/src/runtime-input-cache.ts";
import { installedPackages, nativePackages, runtimeFor, incompatible, type Runtime } from "../packages/cli/src/project.ts";

const watching = vi.hoisted(() => ({ base: "", failAt: Infinity, opened: 0, live: new Set<import("node:fs").FSWatcher>() }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, statSync: vi.fn(actual.statSync), watch: vi.fn((location: fs.PathLike, options: { recursive?: boolean }, callback: fs.WatchListener<string>) => {
    if (++watching.opened === watching.failAt) throw new Error("watch unavailable");
    // Do not watch machine-wide module search paths in this isolated fixture.
    const watcher = String(location).startsWith(watching.base + path.sep)
      ? actual.watch(location, options, callback)
      : Object.assign(new EventEmitter(), { close() {} }) as fs.FSWatcher;
    watching.live.add(watcher);
    const close = watcher.close.bind(watcher);
    watcher.close = () => { watching.live.delete(watcher); close(); };
    return watcher;
  }) };
});
vi.mock("../packages/cli/src/project.ts", async importOriginal => {
  const actual = await importOriginal<typeof import("../packages/cli/src/project.ts")>();
  return { ...actual, installedPackages: vi.fn(actual.installedPackages), nativePackages: vi.fn(actual.nativePackages) };
});
vi.mock("@legendapp/spark-desktop-config/config.cjs", async importOriginal => ({
  ...await importOriginal<object>(), isExpoProject: vi.fn(() => false),
}));
import { isExpoProject } from "@legendapp/spark-desktop-config/config.cjs";

const pause = () => new Promise(resolve => setTimeout(resolve, 250));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  expect(watching.live.size).toBe(0);
  watching.opened = 0;
  watching.failAt = Infinity;
  vi.clearAllMocks();
  vi.mocked(isExpoProject).mockReturnValue(false);
});
function json(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "spark-input-cache-")));
  watching.base = base;
  cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "app"), native = path.join(base, "workspace/native"), plain = path.join(base, "workspace/plain");
  json(path.join(root, "package.json"), { dependencies: { native: "1", plain: "1" } });
  json(path.join(root, "app.json"), { expo: { name: "Fixture", platforms: ["macos"] } });
  json(path.join(native, "package.json"), { name: "native", version: "1", spark: { nativeModules: true } });
  json(path.join(plain, "package.json"), { name: "plain", version: "1" });
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.mkdirSync(path.join(native, "macos"));
  fs.writeFileSync(path.join(native, "macos/one.mm"), "one");
  for (const [name, target] of [["native", native], ["plain", plain]]) fs.symlinkSync(target!, path.join(root, "node_modules", name!));
  function load(projectRoot = root) {
    const cache = createRuntimeInputCache(projectRoot);
    cleanups.push(() => cache.close());
    return cache;
  }
  return { base, root, native, plain, load };
}
async function settle(cache: ReturnType<typeof createRuntimeInputCache>) {
  cache.read();
  await pause();
  cache.read();
  await pause();
  return cache.read();
}

test("60 unchanged polls do no graph work and reuse the lazy development fingerprint", async () => {
  const f = fixture(), cache = f.load();
  const first = await settle(cache);
  const opened = watching.opened;
  const calls = vi.mocked(nativePackages).mock.calls.length, graphs = vi.mocked(installedPackages).mock.calls.length;
  first.development = runtimeFor(f.root, first.native, "dev");
  for (let i = 0; i < 60; i++) expect(cache.read()).toBe(first);
  expect(nativePackages).toHaveBeenCalledTimes(calls);
  expect(installedPackages).toHaveBeenCalledTimes(graphs);
  expect(watching.opened).toBe(opened);
  cache.invalidate();
  expect(cache.read()).not.toBe(first);
  expect(cache.read().development).toBeUndefined();
  expect(nativePackages).toHaveBeenCalledTimes(calls + 1);
});

test("real source, manifest, configuration and resolution transitions recompute inputs", async () => {
  const f = fixture(), cache = f.load();
  let previous = await settle(cache);
  const originalRuntime = runtimeFor(f.root, previous.native, "dev");
  const operations: [string, () => void][] = [
    ["native edit", () => fs.writeFileSync(path.join(f.native, "macos/one.mm"), "two")],
    ["native add", () => fs.writeFileSync(path.join(f.native, "macos/two.mm"), "two")],
    ["native remove", () => fs.unlinkSync(path.join(f.native, "macos/two.mm"))],
    ["new native marker", () => fs.writeFileSync(path.join(f.plain, "Module.podspec"), "spec")],
    ["package upgrade", () => json(path.join(f.plain, "package.json"), { name: "plain", version: "2" })],
    ["package add", () => {
      json(path.join(f.root, "node_modules/added/package.json"), { name: "added", version: "1", spark: { nativeModules: true } });
      json(path.join(f.root, "package.json"), { dependencies: { native: "1", plain: "2", added: "1" } });
    }],
    ["package remove", () => json(path.join(f.root, "package.json"), { dependencies: { native: "1", plain: "2" } })],
    ["app config", () => json(path.join(f.root, "app.json"), { expo: { name: "Changed", platforms: ["macos"] } })],
    ["host config", () => json(path.join(f.root, "desktop.config.json"), { name: "Fixture", projectId: "fixture", version: "1", macos: { bundleIdentifier: "com.test.fixture" } })],
    ["signing config", () => json(path.join(f.root, ".spark/settings.json"), { macOSDevelopmentIdentity: "Apple Development: Fixture" })],
    ["lockfile", () => fs.writeFileSync(path.join(f.root, "bun.lock"), "changed")],
    ["new resolution directory", () => fs.mkdirSync(path.join(f.native, "node_modules"))],
    ["new dependency link", () => fs.symlinkSync(f.native, path.join(f.root, "node_modules/linked"))],
    ["dependency link replacement", () => {
      fs.unlinkSync(path.join(f.root, "node_modules/linked"));
      fs.symlinkSync(f.plain, path.join(f.root, "node_modules/linked"));
    }],
    ["package root replacement", () => {
      fs.renameSync(f.plain, f.plain + "-old");
      json(path.join(f.plain, "package.json"), { name: "plain", version: "3", spark: { nativeModules: true } });
      fs.mkdirSync(path.join(f.plain, "src"));
      fs.writeFileSync(path.join(f.plain, "src/one.mm"), "one");
    }],
    ["edit replaced package source", () => fs.writeFileSync(path.join(f.plain, "src/one.mm"), "two")],
  ];
  for (const [label, operation] of operations) {
    previous.development = originalRuntime;
    operation();
    await vi.waitFor(() => expect(cache.read(), label).not.toBe(previous), { timeout: 3000, interval: 100 });
    const next = await settle(cache);
    expect(next.development, label).toBeUndefined();
    expect(incompatible(originalRuntime, next.native), label).not.toEqual([]);
    previous = next;
  }
}, 20000);

test("module root replacement is detected synchronously and rearms source watches", async () => {
  const f = fixture(), cache = f.load();
  const previous = await settle(cache);
  const modules = path.join(f.root, "node_modules");
  fs.renameSync(modules, modules + "-old");
  fs.mkdirSync(modules);
  for (const [name, target] of [["native", f.native], ["plain", f.plain]]) fs.symlinkSync(target!, path.join(modules, name!));
  expect(cache.read()).not.toBe(previous);
  await settle(cache);
  const stable = cache.read();
  json(path.join(modules, "new/package.json"), { name: "new", version: "1" });
  await vi.waitFor(() => expect(cache.read()).not.toBe(stable), { timeout: 3000 });
});

test("session output does not invalidate ordinary or platform caches", async () => {
  const f = fixture(), cache = f.load();
  for (const directory of [".spark", ".spark/platforms/macos"]) fs.mkdirSync(path.join(f.root, directory), { recursive: true });
  const previous = await settle(cache);
  for (const directory of [".spark", ".spark/platforms/macos"]) {
    const temporary = path.join(f.root, directory, `session.json.${process.pid}.tmp`);
    fs.writeFileSync(temporary, "{}");
    fs.renameSync(temporary, path.join(f.root, directory, "session.json"));
    await pause();
    expect(cache.read()).toBe(previous);
  }
});

test("watch readiness and concurrent graph changes force another fill", async () => {
  const f = fixture(), cache = f.load();
  const first = cache.read();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(cache.read()).not.toBe(first);
  const graph = installedPackages(f.root);
  vi.mocked(installedPackages).mockReturnValueOnce(graph).mockReturnValueOnce([]);
  cache.invalidate();
  const raced = cache.read();
  expect(cache.read()).not.toBe(raced);
});

test("a failed calculation stays dirty for the next poll", () => {
  const f = fixture(), cache = f.load();
  vi.mocked(nativePackages).mockImplementationOnce(() => { throw new Error("installation in progress"); });
  expect(() => cache.read()).toThrow("installation in progress");
  expect(cache.read().native.map(pkg => pkg.name)).toEqual(["native"]);
  expect(nativePackages).toHaveBeenCalledTimes(2);
});

test("watch startup and asynchronous errors fall back to polling and close all watches", async () => {
  const f = fixture();
  watching.failAt = 2; // Also closes watchers created before a partial startup failure.
  const failed = f.load();
  expect(failed.read()).not.toBe(failed.read());
  expect(watching.live.size).toBe(0);
  watching.failAt = Infinity;
  const cache = f.load();
  await settle(cache);
  watching.live.values().next().value!.emit("error", new Error("watch failed"));
  expect(watching.live.size).toBe(0);
  expect(cache.read()).not.toBe(cache.read());
});

test("dynamic Expo config and failed resolution stats retain uncached polling", async () => {
  const f = fixture();
  vi.mocked(isExpoProject).mockReturnValue(true);
  const dynamic = f.load();
  expect(dynamic.read()).not.toBe(dynamic.read());
  expect(watching.live.size).toBe(0);
  vi.mocked(isExpoProject).mockReturnValue(false);
  const cache = f.load();
  await settle(cache);
  vi.mocked(fs.statSync).mockImplementationOnce(() => { throw new Error("stat failed"); });
  expect(cache.read()).not.toBe(cache.read());
  expect(watching.live.size).toBe(0);
});

test("lexical symlink roots reach graph resolution unchanged and close cancels readiness", async () => {
  const f = fixture(), linked = path.join(f.base, "linked-app");
  fs.symlinkSync(f.root, linked);
  const cache = f.load(linked);
  cache.read();
  expect(vi.mocked(installedPackages).mock.calls.every(([root]) => root === linked)).toBe(true);
  expect(vi.mocked(nativePackages).mock.calls.every(([root]) => root === linked)).toBe(true);
  cache.close();
  cache.close();
  expect(watching.live.size).toBe(0);
  await new Promise<void>(resolve => setImmediate(resolve));
  const closed = cache.read();
  closed.development = {} as Runtime;
  expect(cache.read().development).toBeUndefined();
  expect(watching.live.size).toBe(0);
});
