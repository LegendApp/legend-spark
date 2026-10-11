import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create: render } = createRequire(import.meta.url)("react-test-renderer");

// An in-memory file system behind the native boundary: the session and versions modules run unmodified.
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" }, installed: true,
  disk: new Map<string, string>(), locked: new Set<string>(), readOnly: new Set<string>(),
  versions: new Map<string, { id: string; text: string }[]>(),
  watchers: new Map<string, () => void>(), calls: [] as { method: string; args: any }[],
  windowUpdates: [] as any[], noVersions: false,
}));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: () => mocks.installed ? {} : null }, NativeEventEmitter: class {} }));
const SparkError = (await import("../packages/desktop-app/src/contracts/index.ts")).SparkError;
const fail = (code: string, message = code) => { throw new SparkError(code as any, message); };
const read = (path: string) => mocks.disk.get(path) ?? fail("E_NOT_FOUND");
const writable = (path: string) => { if (mocks.locked.has(path)) fail("E_PERMISSION_DENIED"); };
const changed = (path: string) => { for (const [watched, listener] of mocks.watchers) if (watched === path) listener(); };
vi.mock("@legendapp/spark-file-system", () => ({
  readText: vi.fn(async (path: string, options: object) => { mocks.calls.push({ method: "readText", args: { path, options } }); return read(path); }),
  writeText: vi.fn(async (path: string, text: string, options: object) => { mocks.calls.push({ method: "writeText", args: { path, text, options } }); writable(path); mocks.disk.set(path, text); changed(path); }),
  writeTextIfUnchanged: vi.fn(async (path: string, expected: string, text: string, options: object) => {
    mocks.calls.push({ method: "writeTextIfUnchanged", args: { path, expected, text, options } });
    if (read(path) !== expected) return { written: false };
    writable(path); mocks.disk.set(path, text); changed(path); return { written: true };
  }),
  move: vi.fn(async (from: string, to: string, options: object) => {
    mocks.calls.push({ method: "move", args: { from, to, options } });
    writable(from); if (mocks.disk.has(to)) fail("E_ALREADY_EXISTS");
    mocks.disk.set(to, read(from)); mocks.disk.delete(from);
    mocks.versions.set(to, mocks.versions.get(from) ?? []); mocks.versions.delete(from); changed(from);
  }),
  watch: vi.fn(async (path: string, listener: () => void) => { mocks.watchers.set(path, listener); return { remove: async () => { mocks.watchers.delete(path); } }; }),
}));
vi.mock("@legendapp/spark-desktop-windows/src/api", () => ({ setWindowOptions: vi.fn(async (id: string, options: object) => { mocks.windowUpdates.push({ id, ...options }); }) }));
vi.mock("@legendapp/spark-file-system/src/native", async () => {
  const support: Record<string, string[]> = { coordination: ["macos"], versions: ["macos"] };
  const featureAvailability = (feature: string) => !["macos", "windows"].includes(mocks.platform.OS) || !support[feature]!.includes(mocks.platform.OS)
    ? { available: false, reason: "unsupported-platform" } : mocks.installed ? { available: true } : { available: false, reason: "missing-module" };
  return {
    featureAvailability,
    requireFeature: (feature: string, label: string) => {
      const availability = featureAvailability(feature) as { available: boolean; reason?: string };
      if (!availability.available) fail(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", label);
    },
    absolute: (path: string) => { if (path.startsWith("file://")) return decodeURIComponent(path.slice(7)); if (!path.startsWith("/")) fail("E_INVALID_ARGUMENT"); return path; },
    call: vi.fn(async (method: string, args: any, valid: (value: unknown) => boolean) => {
      mocks.calls.push({ method, args });
      const list = () => mocks.versions.get(args.path) ?? [];
      const describe = (version: { id: string }, index: number) => ({ id: version.id, name: "doc", path: `/revisions/${version.id}`, modifiedAt: index + 1 });
      let value: unknown = null;
      if (method === "documentState") { read(args.path); value = { locked: mocks.locked.has(args.path), writable: !mocks.locked.has(args.path) && !mocks.readOnly.has(args.path) }; }
      else if (method === "setLocked") { read(args.path); if (args.locked) mocks.locked.add(args.path); else mocks.locked.delete(args.path); }
      else if (method === "addVersion") {
        if (mocks.noVersions) fail("E_UNAVAILABLE");
        const version = { id: `v${mocks.calls.length}`, text: read(args.path) };
        mocks.versions.set(args.path, [...list(), version]); value = describe(version, list().length - 1);
      } else if (method === "versions") { read(args.path); value = list().map(describe).reverse(); }
      else if (method === "restoreVersion") {
        const version = list().find(entry => entry.id === args.id) ?? fail("E_NOT_FOUND");
        mocks.versions.set(args.path, [...list(), { id: `v${mocks.calls.length}`, text: read(args.path) }]);
        mocks.disk.set(args.path, version.text); changed(args.path);
      }
      if (!valid(value)) fail("E_INVALID_DATA");
      return value;
    }),
  };
});
const documents = await import("../packages/documents/src/index.tsx");
const { useDocumentSessionState } = await import("../packages/documents/src/hooks.ts");
const untitledName = (n: number) => n === 1 ? "Untitled" : `Untitled ${n}`;
const sessions: { remove(): Promise<void> }[] = [];
const create = (options: Partial<Parameters<typeof documents.createDocumentSession>[0]> = {}) => {
  const session = documents.createDocumentSession({ untitledName, onError: vi.fn(), ...options });
  sessions.push(session); return session;
};
const methods = (name: string) => mocks.calls.filter(call => call.method === name);
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
  mocks.platform.OS = "macos"; mocks.installed = true; mocks.noVersions = false;
  for (const value of [mocks.disk, mocks.locked, mocks.readOnly, mocks.versions, mocks.watchers]) value.clear();
  mocks.calls.length = 0; mocks.windowUpdates.length = 0;
});
afterEach(async () => { vi.useRealTimers(); await Promise.allSettled(sessions.splice(0).map(session => session.remove())); });

test("availability is macOS-only; Windows and a missing module fail typed before native dispatch", async () => {
  expect(documents.getDocumentSessionAvailability()).toEqual({ available: true });
  expect(documents.getDocumentVersionsAvailability()).toEqual({ available: true });
  mocks.platform.OS = "windows";
  expect(documents.getDocumentSessionAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(documents.getDocumentVersionsAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => create()).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  for (const attempt of [() => documents.listDocumentVersions("/a"), () => documents.addDocumentVersion("/a"), () => documents.restoreDocumentVersion("/a", "v")]) {
    await expect(attempt()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
  expect(mocks.calls).toEqual([]);
  mocks.platform.OS = "macos"; mocks.installed = false;
  expect(documents.getDocumentSessionAvailability()).toEqual({ available: false, reason: "missing-module" });
  expect(() => create()).toThrow(expect.objectContaining({ code: "E_MODULE_UNAVAILABLE" }));
  await expect(documents.listDocumentVersions("/a")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

test("options are validated, unknown keys reject", () => {
  expect(() => create({ autosave: true } as any)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => create({ autosave: { delayMs: -1 } })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => create({ windowId: "bad id" })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => create({ title: "x" } as any)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => create({ untitledName: () => "" })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("untitled documents take the lowest free number and free it on removal or once saved", async () => {
  const first = create(), second = create(), third = create();
  expect([first, second, third].map(session => session.getState().name)).toEqual(["Untitled", "Untitled 2", "Untitled 3"]);
  await first.remove();
  expect(create().getState().name).toBe("Untitled");
  await second.saveAs("/docs/saved.txt");
  expect(second.getState()).toMatchObject({ path: "/docs/saved.txt", name: "saved.txt", edited: false });
  expect(create().getState().name).toBe("Untitled 2");
  const copy = create({ text: "copied", untitledName: n => n === 1 ? "notes copy" : `notes copy ${n}` });
  expect(copy.getState()).toMatchObject({ name: "notes copy", edited: true });
});

test("dirty tracking drives the window's edited dot and proxy icon; save writes conditionally and records versions", async () => {
  mocks.disk.set("/docs/my notes.md", "hello");
  const session = create({ windowId: "main" });
  const seen: boolean[] = []; session.subscribe(() => seen.push(session.getState().edited));
  await session.open("/docs/./my notes.md");
  expect(session.getState()).toMatchObject({ path: "/docs/my notes.md", name: "my notes.md", text: "hello", edited: false, locked: false, readOnly: false });
  session.setText("hello!"); await tick();
  expect(session.getState().edited).toBe(true);
  expect(mocks.windowUpdates.at(-1)).toEqual({ id: "main", macos: { documentEdited: true, representedUri: "file:///docs/my%20notes.md" } });
  expect(await session.save()).toEqual({ saved: true });
  expect(methods("writeTextIfUnchanged").at(-1)!.args).toEqual({ path: "/docs/my notes.md", expected: "hello", text: "hello!", options: { coordinated: true } });
  // The as-opened contents are kept before the first write, then the saved contents.
  expect(mocks.versions.get("/docs/my notes.md")!.map(version => version.text)).toEqual(["hello", "hello!"]);
  await tick();
  expect(session.getState().edited).toBe(false);
  expect(mocks.windowUpdates.at(-1)).toEqual({ id: "main", macos: { documentEdited: false, representedUri: "file:///docs/my%20notes.md" } });
  expect(seen).toContain(true);
  await session.remove();
  expect(mocks.windowUpdates.at(-1)).toEqual({ id: "main", macos: { documentEdited: false, representedUri: null } });
  expect(mocks.watchers.size).toBe(0);
  expect(() => session.setText("x")).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  await expect(session.save()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("a save that finds the file changed reports a conflict; overwrite or revert resolves it", async () => {
  mocks.disk.set("/d/a.txt", "base");
  const session = create(); await session.open("/d/a.txt");
  session.setText("mine"); mocks.watchers.clear(); mocks.disk.set("/d/a.txt", "theirs");
  expect(await session.save()).toEqual({ saved: false, reason: "conflict" });
  expect(session.getState()).toMatchObject({ conflict: true, edited: true });
  expect(mocks.disk.get("/d/a.txt")).toBe("theirs");
  expect(await session.save({ overwrite: true })).toEqual({ saved: true });
  expect(mocks.disk.get("/d/a.txt")).toBe("mine");
  expect(session.getState()).toMatchObject({ conflict: false, edited: false });
  session.setText("again"); mocks.disk.set("/d/a.txt", "theirs 2");
  await session.revertToSaved();
  expect(session.getState()).toMatchObject({ text: "theirs 2", edited: false, conflict: false });
  await expect(session.save({ force: true } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(create().save()).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("external changes reload a clean document and flag a conflict under unsaved edits", async () => {
  vi.useFakeTimers();
  mocks.disk.set("/d/a.txt", "one");
  const session = create(); await session.open("/d/a.txt");
  mocks.disk.set("/d/a.txt", "two"); changed("/d/a.txt");
  await vi.advanceTimersByTimeAsync(150);
  expect(session.getState()).toMatchObject({ text: "two", edited: false, conflict: false });
  session.setText("local");
  mocks.disk.set("/d/a.txt", "three"); changed("/d/a.txt");
  await vi.advanceTimersByTimeAsync(150);
  expect(session.getState()).toMatchObject({ text: "local", edited: true, conflict: true });
  // The session's own writes are not external changes.
  await session.save({ overwrite: true }); await vi.advanceTimersByTimeAsync(150);
  expect(session.getState()).toMatchObject({ text: "local", edited: false, conflict: false });
});

test("autosave writes in place after the delay, skips conflicts and flushes on removal", async () => {
  vi.useFakeTimers();
  mocks.disk.set("/d/a.txt", "start");
  const onError = vi.fn();
  const session = create({ autosave: { delayMs: 500 }, onError }); await session.open("/d/a.txt");
  session.setText("s"); session.setText("st");
  await vi.advanceTimersByTimeAsync(499); expect(mocks.disk.get("/d/a.txt")).toBe("start");
  await vi.advanceTimersByTimeAsync(1); await vi.advanceTimersByTimeAsync(150);
  expect(mocks.disk.get("/d/a.txt")).toBe("st");
  expect(session.getState().edited).toBe(false);
  expect(mocks.versions.get("/d/a.txt")!.map(version => version.text)).toEqual(["start"]); // autosaves add no versions
  mocks.watchers.clear(); mocks.disk.set("/d/a.txt", "theirs");
  session.setText("mine"); await vi.advanceTimersByTimeAsync(500);
  expect(session.getState().conflict).toBe(true); expect(mocks.disk.get("/d/a.txt")).toBe("theirs");
  session.setText("mine 2"); await vi.advanceTimersByTimeAsync(500);
  expect(mocks.disk.get("/d/a.txt")).toBe("theirs");
  await session.save({ overwrite: true });
  session.setText("pending");
  await session.remove();
  expect(mocks.disk.get("/d/a.txt")).toBe("pending");
  expect(onError).not.toHaveBeenCalled();
});

test("autosave and save still work on volumes without a revision store", async () => {
  mocks.noVersions = true; mocks.disk.set("/fat/a.txt", "a");
  const session = create(); await session.open("/fat/a.txt");
  session.setText("b");
  expect(await session.save()).toEqual({ saved: true });
  expect(mocks.disk.get("/fat/a.txt")).toBe("b");
  await expect(documents.addDocumentVersion("/fat/a.txt")).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
});

test("duplicate, rename, move to, versions and locking", async () => {
  mocks.disk.set("/d/notes.md", "v1");
  const session = create({ windowId: "main" }); await session.open("/d/notes.md");
  session.setText("unsaved");
  expect(session.duplicate()).toEqual({ text: "unsaved", name: "notes" });
  await session.save();
  await session.rename("renamed.md");
  expect(session.getState()).toMatchObject({ path: "/d/renamed.md", name: "renamed.md" });
  expect(methods("move").at(-1)!.args).toEqual({ from: "/d/notes.md", to: "/d/renamed.md", options: { coordinated: true } });
  for (const name of ["", "a/b", "..", "x\0"]) await expect(session.rename(name)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  mocks.disk.set("/d/taken.md", "x");
  await expect(session.rename("taken.md")).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  await session.moveTo("/archive/");
  expect(session.getState().path).toBe("/archive/renamed.md");
  expect(documents.findDocumentSession("/archive/renamed.md")).toBe(session);
  expect(documents.findDocumentSession("/d/notes.md")).toBeUndefined();
  await tick();
  expect(mocks.windowUpdates.at(-1).macos.representedUri).toBe("file:///archive/renamed.md");

  const versions = await documents.listDocumentVersions("/archive/renamed.md");
  expect(versions.map(version => mocks.versions.get("/archive/renamed.md")!.find(entry => entry.id === version.id)!.text)).toEqual(["unsaved", "v1"]);
  session.setText("dirty");
  await expect(session.restoreVersion(versions.at(-1)!.id)).rejects.toMatchObject({ code: "E_BUSY" });
  await session.revertToSaved();
  await session.restoreVersion(versions.at(-1)!.id);
  expect(session.getState()).toMatchObject({ text: "v1", edited: false });
  expect((await documents.listDocumentVersions("/archive/renamed.md")).length).toBe(3);
  await expect(documents.restoreDocumentVersion("/archive/renamed.md", "")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });

  await session.setLocked(true);
  expect(session.getState()).toMatchObject({ locked: true, readOnly: true });
  session.setText("blocked");
  await expect(session.save()).rejects.toMatchObject({ code: "E_READ_ONLY" });
  await expect(session.rename("other.md")).rejects.toMatchObject({ code: "E_READ_ONLY" });
  await session.setLocked(false);
  expect(await session.save()).toEqual({ saved: true });
  mocks.readOnly.add("/archive/renamed.md"); session.setText("ro");
  await expect(session.save()).rejects.toMatchObject({ code: "E_READ_ONLY" });
  expect(session.getState()).toMatchObject({ locked: false, readOnly: true });
});

test("a document opens in one session at a time; an edited session cannot open another file", async () => {
  mocks.disk.set("/d/a.txt", "a"); mocks.disk.set("/d/b.txt", "b");
  const first = create({ windowId: "doc-1" }); await first.open("/d/a.txt");
  await expect(create().open("/d/../d/a.txt")).rejects.toMatchObject({ code: "E_BUSY", message: expect.stringContaining("doc-1") });
  expect(documents.findDocumentSession("file:///d/a.txt")?.windowId).toBe("doc-1");
  first.setText("edited");
  await expect(first.open("/d/b.txt")).rejects.toMatchObject({ code: "E_BUSY" });
  await expect(create().saveAs("/d/a.txt")).rejects.toMatchObject({ code: "E_BUSY" });
  await first.remove();
  expect(documents.findDocumentSession("/d/a.txt")).toBeUndefined();
});

test("useDocumentSessionState observes a caller-owned session and never removes it", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const session = create();
  const seen: string[] = [];
  function Probe() { seen.push(useDocumentSessionState(session).text); return null; }
  let rendered: any;
  await act(async () => { rendered = create_(Probe); });
  await act(async () => { session.setText("typed"); });
  expect(seen.at(-1)).toBe("typed");
  await act(async () => { rendered.unmount(); });
  session.setText("after"); expect(session.getState().text).toBe("after");
  await session.remove();
  await act(async () => { rendered = create_(Probe); });
  expect(seen.at(-1)).toBe("after");
  await act(async () => { rendered.unmount(); });
});
function create_(Component: () => null) { return render(React.createElement(Component)); }
