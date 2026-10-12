import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/plugins against a fake Runtimes module that crosses a JSON boundary per call, as the real one does.
// It cannot show heap isolation; the Kitchen Sink flows run the real runtimes (e2e/flows/future-facing-capabilities/plugins-*.yaml).
const platform = { OS: "macos" };
const nativeModules: Record<string, unknown> = { ThreadedRuntime: {} };
vi.doMock("react-native", () => ({ Platform: platform, NativeModules: nativeModules }));
const plugins = await import("../packages/plugins/src/index.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
type Entry = import("../packages/plugins/src/types.ts").PluginEntry;
type Manifest = import("../packages/plugins/src/types.ts").PluginManifest;

const live = new Set<string>();
const destroyed: string[] = [];
let hold: ((request: unknown) => Promise<unknown> | undefined) = () => undefined;
const runtimes = {
  ThreadedRuntime: {
    async run(name: string, fn: Entry, request: unknown) {
      live.add(name);
      const held = hold(request);
      if (held) return held;
      return JSON.parse(JSON.stringify(await fn(JSON.parse(JSON.stringify(request)))));
    },
    async destroy(name: string) { live.delete(name); destroyed.push(name); },
  },
};
const bundled = (fn: ReturnType<typeof plugins.definePlugin>, id: string): Entry => Object.assign(fn, { __runtimeFunction: { id } });
const manifest = (id: string, capabilities: Manifest["capabilities"], extra: Partial<Manifest> = {}): Manifest => ({ id, name: id, version: "1.0.0", apiVersion: 1, capabilities, ...extra });

const notes = manifest("com.example.notes", ["commands", "panels", "fileTypes", "menuItems"]);
let count = 0;
const notesEntry = bundled(plugins.definePlugin(notes, {
  activate: () => ({
    commands: [{ id: "com.example.notes.count", title: "Count" }, { id: "com.example.notes.crash", title: "Crash" }, { id: "com.example.notes.open", title: "Open" }],
    panels: [{ id: "com.example.notes.panel", title: "Notes", component: "notes-panel" }],
    fileTypes: [{ id: "com.example.notes.note", name: "Note", extensions: ["note", "txt"], command: "com.example.notes.open" }],
    menuItems: [{ id: "com.example.notes.menu-count", title: "Count", command: "com.example.notes.count" }],
  }),
  commands: {
    "com.example.notes.count": args => ({ count: ++count, args }),
    "com.example.notes.crash": () => { throw new TypeError("notes crashed"); },
    "com.example.notes.open": args => ({ opened: (args as { path: string }).path }),
  },
}), "plugins.notes");
const echo = manifest("com.example.echo", ["commands"]);
const echoEntry = bundled(plugins.definePlugin(echo, { activate: () => ({ commands: [{ id: "com.example.echo.echo", title: "Echo" }] }), commands: { "com.example.echo.echo": args => args } }), "plugins.echo");
const sources = () => [{ manifest: notes, entry: notesEntry, grant: notes.capabilities }, { manifest: echo, entry: echoEntry, grant: ["commands"] as const }];
const host = (extra: Partial<Parameters<typeof plugins.createPluginHost>[0]> = {}) => plugins.createPluginHost({ runtimes, plugins: sources(), ...extra });
beforeEach(() => { platform.OS = "macos"; nativeModules.ThreadedRuntime = {}; live.clear(); destroyed.length = 0; hold = () => undefined; count = 0; });

test("availability: macOS with the Runtimes module; Windows and other platforms are typed unsupported", async () => {
  expect(plugins.getPluginAvailability()).toEqual({ available: true });
  delete nativeModules.ThreadedRuntime;
  expect(plugins.getPluginAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(host().load(echo.id)).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  for (const os of ["windows", "web", "ios"]) {
    platform.OS = os;
    expect(plugins.getPluginAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(host().load(echo.id)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
  expect(live.size).toBe(0);
});

test("only declared, bundled entries are accepted; manifests are validated before anything runs", () => {
  const create = (plugin: unknown) => () => plugins.createPluginHost({ runtimes, plugins: [plugin as never] });
  for (const entry of ["https://example.com/plugin.js", "return 1", () => ({}), { __runtimeFunction: { id: "x" } }]) {
    expect(create({ manifest: echo, entry, grant: [] })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  const bad: unknown[] = [
    { ...echo, id: "Echo" }, { ...echo, id: "echo" }, { ...echo, version: "1.0" }, { ...echo, apiVersion: 0 }, { ...echo, apiVersion: 1.5 },
    { ...echo, capabilities: ["commands", "commands"] }, { ...echo, capabilities: ["network"] }, { ...echo, name: " " }, { ...echo, url: "https://x" }, null,
  ];
  for (const value of bad) expect(create({ manifest: value, entry: echoEntry, grant: [] })).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(create({ manifest: echo, entry: echoEntry, grant: ["files"] })).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(() => plugins.createPluginHost({ runtimes, plugins: [...sources(), sources()[1]!] })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  expect(() => plugins.createPluginHost({ runtimes: {} as never, plugins: [] })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  for (const timeoutMs of [0, 1.5, 2147483648]) expect(() => host({ timeoutMs })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("load activates in the plugin's own runtime and registers every contribution kind", async () => {
  const plugin = host();
  expect(plugin.list().map(info => [info.manifest.id, info.state, info.runtimeName])).toEqual([
    ["com.example.notes", "unloaded", "spark-plugin.com.example.notes"], ["com.example.echo", "unloaded", "spark-plugin.com.example.echo"],
  ]);
  const changes = vi.fn();
  plugin.subscribe(changes);
  const [first, joined] = [plugin.load(notes.id), plugin.load(notes.id)];
  expect(await joined).toEqual(await first);
  const info = plugin.get(notes.id);
  expect(info.state).toBe("loaded");
  expect(info.contributions.commands.map(command => command.id)).toEqual(["com.example.notes.count", "com.example.notes.crash", "com.example.notes.open"]);
  expect(info.contributions.panels).toEqual([{ id: "com.example.notes.panel", title: "Notes", component: "notes-panel" }]);
  expect(info.contributions.menuItems).toHaveLength(1);
  expect([...live]).toEqual(["spark-plugin.com.example.notes"]);
  expect(changes).toHaveBeenCalledTimes(2); // loading, loaded
  const snapshot = plugin.list();
  expect(plugin.list()).toBe(snapshot);
  expect(await plugin.execute(notes.id, "com.example.notes.count", { n: 1 })).toEqual({ count: 1, args: { n: 1 } });
  expect(plugin.findFileHandlers("/tmp/a.NOTE").map(handler => handler.fileType.id)).toEqual(["com.example.notes.note"]);
  expect(plugin.findFileHandlers("C:\\notes\\b.txt")).toHaveLength(1);
  expect(plugin.findFileHandlers("/tmp/.note")).toEqual([]);
  expect(plugin.findFileHandlers("/tmp/a.md")).toEqual([]);
});

test("version and grant checks reject with SparkErrors before the plugin's runtime starts", async () => {
  const future = manifest("com.example.future", ["commands"], { apiVersion: 2 });
  const greedy = manifest("com.example.greedy", ["commands", "menuItems"]);
  const never = bundled(plugins.definePlugin(future, { activate: () => { throw new Error("must not run"); } }), "plugins.never");
  const plugin = plugins.createPluginHost({ runtimes, plugins: [{ manifest: future, entry: never, grant: ["commands"] }, { manifest: greedy, entry: never, grant: ["commands"] }] });
  await expect(plugin.load(future.id)).rejects.toMatchObject({ name: "SparkError", code: "E_UNSUPPORTED_OPTION" });
  await expect(plugin.load(greedy.id)).rejects.toMatchObject({ name: "SparkError", code: "E_PERMISSION_DENIED", message: expect.stringContaining("menuItems") });
  expect(plugin.get(future.id)).toMatchObject({ state: "failed", error: { code: "E_UNSUPPORTED_OPTION" } });
  expect(live.size).toBe(0);
  await expect(plugin.load("com.example.missing")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("a sandbox violation (an undeclared kind, or another namespace) fails the load and destroys the runtime", async () => {
  const sneaky = manifest("com.example.sneaky", ["commands"]);
  const cases: [string, object][] = [
    ["menu item without menuItems", { commands: [{ id: "com.example.sneaky.a", title: "A" }], menuItems: [{ id: "com.example.sneaky.m", title: "M", command: "com.example.sneaky.a" }] }],
    ["another plugin's namespace", { commands: [{ id: "com.example.notes.count", title: "Hijack" }] }],
  ];
  for (const [label, contributions] of cases) {
    const entry = bundled(plugins.definePlugin(sneaky, { activate: () => contributions as never, commands: { "com.example.sneaky.a": () => null, "com.example.notes.count": () => null } }), "plugins.sneaky");
    const plugin = plugins.createPluginHost({ runtimes, plugins: [{ manifest: sneaky, entry, grant: ["commands"] }] });
    await expect(plugin.load(sneaky.id), label).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
    expect(plugin.get(sneaky.id)).toMatchObject({ state: "failed", contributions: { commands: [], menuItems: [] } });
    expect(destroyed.at(-1)).toBe("spark-plugin.com.example.sneaky");
    expect(live.size).toBe(0);
  }
  const malformed = bundled(plugins.definePlugin(sneaky, { activate: () => ({ commands: [{ id: "com.example.sneaky.a", title: "" }] }), commands: { "com.example.sneaky.a": () => null } }), "plugins.malformed");
  await expect(plugins.createPluginHost({ runtimes, plugins: [{ manifest: sneaky, entry: malformed, grant: ["commands"] }] }).load(sneaky.id)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const dangling = bundled(plugins.definePlugin(notes, { activate: () => ({ menuItems: [{ id: "com.example.notes.m", title: "M", command: "com.example.notes.none" }] }) }), "plugins.dangling");
  await expect(plugins.createPluginHost({ runtimes, plugins: [{ manifest: notes, entry: dangling, grant: notes.capabilities }] }).load(notes.id)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("a throwing command is the plugin's error; the plugin and other plugins keep working", async () => {
  const plugin = host();
  await Promise.all([plugin.load(notes.id), plugin.load(echo.id)]);
  const error = await plugin.execute(notes.id, "com.example.notes.crash").catch(failure => failure);
  expect(error).toBeInstanceOf(plugins.PluginError);
  expect(error).toMatchObject({ pluginId: notes.id, phase: "command", pluginErrorName: "TypeError", message: expect.stringContaining("notes crashed") });
  expect(plugin.get(notes.id).state).toBe("loaded");
  expect(await plugin.execute(notes.id, "com.example.notes.count")).toEqual({ count: 1, args: null });
  expect(await plugin.execute(echo.id, "com.example.echo.echo", ["x"])).toEqual(["x"]);
  await expect(plugin.execute(echo.id, "com.example.notes.count")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await expect(plugin.execute(echo.id, "com.example.echo.echo", { bad: 1n } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const activationFails = bundled(plugins.definePlugin(echo, { activate: () => { throw new Error("no"); } }), "plugins.boom");
  const failing = plugins.createPluginHost({ runtimes, plugins: [{ manifest: echo, entry: activationFails, grant: ["commands"] }] });
  await expect(failing.load(echo.id)).rejects.toMatchObject({ name: "PluginError", phase: "activate" });
  expect(failing.get(echo.id)).toMatchObject({ state: "failed", error: { code: "PLUGIN_ERROR" } });
});

test("a plugin that stops answering times out, is withdrawn and its runtime destroyed; others are unaffected", async () => {
  const plugin = host({ timeoutMs: 20 });
  await Promise.all([plugin.load(notes.id), plugin.load(echo.id)]);
  hold = request => (request as { pluginId: string }).pluginId === notes.id ? new Promise(() => {}) : undefined;
  await expect(plugin.execute(notes.id, "com.example.notes.count")).rejects.toMatchObject({ code: "E_TIMEOUT" });
  expect(plugin.get(notes.id)).toMatchObject({ state: "failed", error: { code: "E_TIMEOUT" }, contributions: { commands: [] } });
  expect(destroyed).toEqual(["spark-plugin.com.example.notes"]);
  expect(await plugin.execute(echo.id, "com.example.echo.echo", 1)).toBe(1);
  await expect(plugin.execute(notes.id, "com.example.notes.count")).rejects.toMatchObject({ code: "E_CLOSED" });
  hold = () => undefined;
  expect((await plugin.load(notes.id)).state).toBe("loaded");
  hold = () => Promise.resolve({ unexpected: true });
  await expect(plugin.execute(notes.id, "com.example.notes.count")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(plugin.get(notes.id).state).toBe("failed");
  hold = () => Promise.reject(new Error("Runtime crashed"));
  await expect(plugin.execute(echo.id, "com.example.echo.echo", 1)).rejects.toMatchObject({ code: "E_NATIVE" });
});

test("unload deactivates, withdraws contributions, destroys the runtime and rejects pending calls", async () => {
  const deactivated = vi.fn();
  const slow = manifest("com.example.slow", ["commands"]);
  const entry = bundled(plugins.definePlugin(slow, { activate: () => ({ commands: [{ id: "com.example.slow.wait", title: "Wait" }] }), commands: { "com.example.slow.wait": () => null }, deactivate: deactivated }), "plugins.slow");
  const onError = vi.fn();
  const plugin = plugins.createPluginHost({ runtimes, plugins: [{ manifest: slow, entry, grant: ["commands"] }, ...sources()], onError });
  await plugin.load(slow.id);
  hold = request => (request as { kind: string }).kind === "execute" ? new Promise(() => {}) : undefined;
  const pending = plugin.execute(slow.id, "com.example.slow.wait");
  const [a, b] = [plugin.unload(slow.id), plugin.unload(slow.id)];
  expect(plugin.get(slow.id).state).toBe("unloading");
  await expect(pending).rejects.toMatchObject({ code: "E_CLOSED" });
  await Promise.all([a, b]);
  expect(deactivated).toHaveBeenCalledTimes(1);
  expect(plugin.get(slow.id)).toMatchObject({ state: "unloaded", error: null, contributions: { commands: [] } });
  expect(destroyed).toEqual(["spark-plugin.com.example.slow"]);
  await plugin.unload(slow.id);
  expect(destroyed).toHaveLength(1);
  // A deactivate failure is reported, and the runtime is still destroyed.
  hold = () => undefined;
  const stubborn = bundled(plugins.definePlugin(echo, { activate: () => ({}), deactivate: () => { throw new Error("cannot stop"); } }), "plugins.stubborn");
  const other = plugins.createPluginHost({ runtimes, plugins: [{ manifest: echo, entry: stubborn, grant: ["commands"] }], onError });
  await other.load(echo.id);
  await other.unload(echo.id);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "PluginError", phase: "deactivate" }), echo.id);
  expect(other.get(echo.id).state).toBe("unloaded");
});

test("listeners are isolated from each other; remove unloads everything and closes the host", async () => {
  const onError = vi.fn();
  const plugin = host({ onError });
  const after = vi.fn();
  plugin.subscribe(() => { throw new Error("listener"); });
  const subscription = plugin.subscribe(after);
  await plugin.load(echo.id);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "listener" }), null);
  expect(after).toHaveBeenCalled();
  subscription.remove();
  await plugin.load(notes.id);
  await plugin.remove();
  expect(live.size).toBe(0);
  expect(plugin.list().every(info => info.state === "unloaded")).toBe(true);
  await expect(plugin.load(echo.id)).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(new SparkError("E_CLOSED", "x")).toBeInstanceOf(Error);
});

test("definePlugin answers only its own plugin ID and API version, and requires a handler for every command", async () => {
  const entry = plugins.definePlugin(echo, { activate: () => ({ commands: [{ id: "com.example.echo.missing", title: "Missing" }] }) });
  expect(await entry({ kind: "activate", pluginId: "com.example.other", apiVersion: 1 })).toMatchObject({ ok: false, error: { message: expect.stringContaining("belongs to com.example.echo") } });
  expect(await entry({ kind: "activate", pluginId: echo.id, apiVersion: 2 })).toMatchObject({ ok: false });
  expect(await entry({ kind: "activate", pluginId: echo.id, apiVersion: 1 })).toMatchObject({ ok: false, error: { message: "No handler for command com.example.echo.missing" } });
  expect(await entry({ kind: "execute", pluginId: echo.id, command: "toString", args: null })).toMatchObject({ ok: false });
  const cyclic = plugins.definePlugin(echo, { commands: { "com.example.echo.c": () => { const value: Record<string, unknown> = {}; value.self = value; return value as never; } } });
  expect(await cyclic({ kind: "execute", pluginId: echo.id, command: "com.example.echo.c", args: null })).toMatchObject({ ok: false, error: { name: "TypeError" } });
});

test("usePlugins observes the caller's host under Strict Mode and never unloads on unmount", async () => {
  const { createRequire } = await import("node:module");
  const React = await import("react");
  const { create } = createRequire(import.meta.url)("react-test-renderer");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
  const plugin = host();
  const seen: string[] = [];
  function Root() { seen.push(plugins.usePlugins(plugin).map(info => info.state).join(",")); return null; }
  let rendered: { unmount(): void };
  await React.act(async () => { rendered = create(React.createElement(React.StrictMode, null, React.createElement(Root))); });
  await React.act(async () => { await plugin.load(echo.id); });
  expect(seen.at(-1)).toBe("unloaded,loaded");
  await React.act(async () => { rendered.unmount(); });
  expect(plugin.get(echo.id).state).toBe("loaded");
  const renders = seen.length;
  await plugin.unload(echo.id);
  expect(seen).toHaveLength(renders);
  spy.mockRestore();
});
