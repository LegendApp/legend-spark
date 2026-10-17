import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import type { MenuWireItem } from "../packages/desktop-app/src/contracts/menu";

const state = vi.hoisted(() => ({
  platform: { OS: "macos", constants: { reactNativeVersion: { major: 0, minor: 81, patch: 7, prerelease: null } } },
  installed: true, locale: "en_US", publish: vi.fn(), listeners: new Map<string, Set<(event: unknown) => void>>(),
}));
vi.mock("../packages/native-menu/src/NativeMenu", async () => {
  const { reportingTitles } = await import("./native-menu-double");
  const publish = reportingTitles(json => state.publish(json), () => state.platform.OS === "macos");
  return { get default() { return state.installed ? { publish } : undefined; } };
});
vi.mock("@legendapp/spark-system", () => ({ getSystemInfo: async () => ({ locale: state.locale }) }));
vi.mock("react-native", () => ({ Platform: state.platform, NativeEventEmitter: class {
  addListener(name: string, listener: (event: unknown) => void) {
    if (!state.listeners.has(name)) state.listeners.set(name, new Set());
    state.listeners.get(name)!.add(listener);
    return { remove() { state.listeners.get(name)!.delete(listener); } };
  }
} }));
const modules = async () => ({
  developer: await import("../packages/native-menu/src/developer-menu"),
  api: await import("../packages/native-menu/src/api"),
  tools: await import("../packages/desktop-app/src/contracts/developer-tools"),
});
const published = (): MenuWireItem[] => JSON.parse(state.publish.mock.calls.at(-1)![0]);
const developerRoot = () => published().find(item => item.id === "spark-developer")!;
const item = (id: string) => developerRoot().items!.find(entry => entry.id === id);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", true);
  state.platform.OS = "macos"; state.installed = true; state.locale = "en_US";
  state.publish.mockReset().mockResolvedValue(undefined); state.listeners.clear();
});

test("the Developer menu is one menu owner, composed with the app's menus, placed before Window", async () => {
  const { developer, api } = await modules();
  const app = await api.createMenu({ id: "app", items: [{ type: "submenu", id: "document", label: "Document", items: [{ type: "action", id: "save", label: "Save", shortcut: "Cmd+S" }] }] });
  await developer.installDeveloperMenu();
  expect(published().map(root => root.id)).toEqual(["document", "spark-developer"]);
  expect(developerRoot()).toMatchObject({ title: "Developer", placement: { before: { menu: "window" } } });
  expect(developerRoot().items!.map(entry => entry.separator ? "-" : entry.title)).toEqual(["Reload", "-", "Open DevTools", "Toggle Element Inspector", "Toggle Performance Monitor", "Fast Refresh", "-", "Start Profiling", "Stop Profiling…", "-", "Show Bundle Info", "Show Developer Menu"]);
  expect(developerRoot().items!.filter(entry => !entry.separator).map(entry => entry._sparkDev?.action)).toEqual(["reload", "openDevTools", "toggleInspector", "togglePerfMonitor", "toggleFastRefresh", "startProfiling", "stopProfiling", "bundleInfo", "showMenu"]);
  expect(item("spark-developer-fast-refresh")).toMatchObject({ checked: false });
  // The hidden trigger carries the shortcut: Ctrl (1 << 18) + Cmd (1 << 20).
  expect(item("spark-developer-show")).toMatchObject({ hidden: true, enabled: true, shortcut: { key: "z", modifiers: (1 << 18) | (1 << 20) } });
  expect(developerRoot()._sparkOwner).toBeTruthy();
  expect(api.getDeveloperMenuState()).toEqual({ status: "ready", shortcut: "Ctrl+Cmd+Z" });
  await app.remove();
  expect(published().map(root => root.id)).toEqual(["spark-developer"]);
});

test("Open DevTools is disabled with a tooltip until DevTools support registers, then routes the key window's target", async () => {
  const { developer, tools } = await modules();
  await developer.installDeveloperMenu();
  expect(item("spark-developer-devtools")!._sparkDev).toEqual({ action: "openDevTools", available: false, toolTip: "React Native DevTools is not available in this build." });
  const open = vi.fn(async () => {});
  const registration = tools.registerDevToolsOpener(open);
  await settle();
  expect(item("spark-developer-devtools")!._sparkDev).toEqual({ action: "openDevTools", available: true });
  const emit = (event: unknown) => { for (const listener of state.listeners.get("NativeDeveloperMenu") ?? []) listener(event); };
  emit({ action: "openDevTools", target: { runtime: "isolated", name: "ks-plugins" } });
  emit({ action: "openDevTools", target: { runtime: "isolated" } });
  emit({ action: "reload", target: { runtime: "shared" } });
  expect(open.mock.calls).toEqual([[{ runtime: "isolated", name: "ks-plugins" }]]);
  expect(() => tools.registerDevToolsOpener(async () => {})).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  registration.remove();
  await settle();
  expect(item("spark-developer-devtools")!._sparkDev).toMatchObject({ available: false });
});

test("Start Profiling is disabled with a tooltip without the profiler; with it, Start and Stop Profiling… run it and report the files", async () => {
  const { developer } = await modules();
  await developer.installDeveloperMenu();
  expect(item("spark-developer-start-profiling")!._sparkDev).toEqual({ action: "startProfiling", available: false, toolTip: "The profiler is not available in this build." });
  expect(item("spark-developer-stop-profiling")!._sparkDev).toEqual({ action: "stopProfiling", prompt: "Save Profile Here", message: "Choose a folder for the profile: a Chrome trace and a .cpuprofile for each JavaScript runtime." });

  vi.resetModules();
  state.listeners.clear();
  const { registerProfiler } = await import("../packages/desktop-app/src/profiler");
  const result = { directory: "/tmp/p", trace: "/tmp/p/a.trace.json", frames: {} as never, motions: 0, truncated: false, missing: [],
    profiles: [{ runtime: "shared" as const, path: "/tmp/p/b.cpuprofile", samples: 3, sourceMaps: "unavailable" as const, reason: "no server" }] };
  const start = vi.fn(async () => {}), stop = vi.fn(async () => result);
  registerProfiler({ start, stop, recording: async () => false, observe: () => ({ remove() {} }) });
  await (await import("../packages/native-menu/src/developer-menu")).installDeveloperMenu();
  expect(item("spark-developer-start-profiling")!._sparkDev).toEqual({ action: "startProfiling", available: true });
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const emit = (event: unknown) => { for (const listener of state.listeners.get("NativeDeveloperMenu") ?? []) listener(event); };
  emit({ action: "startProfiling" });
  // Stop needs the folder the developer chose; cancelling the panel sends nothing.
  emit({ action: "stopProfiling" });
  emit({ action: "stopProfiling", directory: "/tmp/p" });
  await settle();
  expect(start.mock.calls).toEqual([[1000]]);
  expect(stop.mock.calls).toEqual([["/tmp/p"]]);
  expect(info.mock.calls.at(-1)![0]).toBe("Profile saved. Trace: /tmp/p/a.trace.json\n/tmp/p/b.cpuprofile (3 samples, no source maps: no server)");
  info.mockRestore();
});

test("the shortcut is free of macOS reservations and yields to a binding another owner holds", async () => {
  const { developer, api } = await modules();
  const { getReservedShortcuts } = await import("../packages/desktop-app/src/contracts/reserved-shortcuts");
  expect(developer.resolveDeveloperShortcut(developer.DEVELOPER_MENU_SHORTCUT, [])).toEqual({ shortcut: "Ctrl+Cmd+Z" });
  expect(getReservedShortcuts("macos").map(entry => entry.accelerator)).not.toContain("Cmd+Ctrl+Z");
  expect(developer.resolveDeveloperShortcut("Cmd+Ctrl+Q", [])).toEqual({ shortcut: null, conflict: { shortcut: "Cmd+Ctrl+Q", with: "system", description: "Locks the screen" } });
  await developer.installDeveloperMenu();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = await api.createMenu({ id: "app", items: [{ type: "submenu", id: "tools", label: "Tools", items: [{ type: "action", id: "zap", label: "Zap", shortcut: "Ctrl+Cmd+Z" }] }] });
  await settle();
  expect(item("spark-developer-show")).toBeUndefined();
  expect(api.getDeveloperMenuState()).toEqual({ status: "ready", shortcut: null, shortcutConflict: { shortcut: "Ctrl+Cmd+Z", with: "menu", description: "menu item Tools › Zap" } });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("menu item Tools › Zap"));
  await app.remove();
  await settle();
  expect(item("spark-developer-show")).toMatchObject({ shortcut: { key: "z" } });
  expect(api.getDeveloperMenuState()).toEqual({ status: "ready", shortcut: "Ctrl+Cmd+Z" });
  warn.mockRestore();
});

test("titles and bundle info follow the system language", async () => {
  state.locale = "ar_EG";
  const { developer } = await modules();
  await developer.installDeveloperMenu();
  expect(developerRoot().title).toBe("المطوّر");
  expect(item("spark-developer-reload")!.title).toBe("إعادة التحميل");
  const info = item("spark-developer-bundle-info")!._sparkDev as Extract<MenuWireItem["_sparkDev"], { action: "bundleInfo" }>;
  expect(info).toMatchObject({ title: "معلومات الحزمة", runtimes: { isolated: "بيئة التشغيل المعزولة «{name}»" } });
  const { developerMenuMessages } = await import("../packages/native-menu/src/developer-menu-messages");
  expect(developerMenuMessages("fr-FR").menu).toBe("Developer");
});

test("bundle info reports the engine, React Native and the lockstep Spark version", async () => {
  const { developer } = await modules();
  const { developerMenuMessages } = await import("../packages/native-menu/src/developer-menu-messages");
  const messages = developerMenuMessages("en");
  const spark = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).version;
  expect(JSON.parse(readFileSync("packages/native-menu/package.json", "utf8")).version).toBe(spark);
  expect(developer.bundleInfoLines(messages, { HermesInternal: { getRuntimeProperties: () => ({ "OSS Release Version": "0.14.0" }) }, RN$Bridgeless: true })).toEqual([
    "Mode: Development, New Architecture (bridgeless)", "JavaScript engine: Hermes 0.14.0", "React Native: 0.81.7", `Spark: ${spark}`,
  ]);
  expect(developer.bundleInfoLines(messages, {})).toContain("JavaScript engine: Not Hermes");
});

test("state reports why there is no menu", async () => {
  vi.stubGlobal("__DEV__", false);
  let { api, developer } = await modules();
  expect(api.getDeveloperMenuState()).toEqual({ status: "unavailable", reason: "release-build" });
  expect(api.getDeveloperMenuState()).toBe(api.getDeveloperMenuState());
  vi.resetModules(); vi.stubGlobal("__DEV__", true);
  ({ api, developer } = await modules());
  expect(api.getDeveloperMenuState()).toEqual({ status: "unavailable", reason: "not-installed" });
  const seen: unknown[] = [];
  const subscription = api.addDeveloperMenuListener(next => seen.push(next.status));
  state.installed = false;
  await developer.installDeveloperMenu();
  expect(api.getDeveloperMenuState()).toEqual({ status: "unavailable", reason: "missing-module" });
  subscription.remove();
  expect(seen).toEqual(["unavailable"]);
  expect(() => api.addDeveloperMenuListener(undefined as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  vi.resetModules(); state.platform.OS = "windows"; state.installed = true;
  ({ api, developer } = await modules());
  await developer.installDeveloperMenu();
  expect(api.getDeveloperMenuState()).toEqual({ status: "unavailable", reason: "unsupported-platform" });
  expect(state.publish).not.toHaveBeenCalled();
});

test("a failed publication is reported, not hidden", async () => {
  const { developer, api } = await modules();
  state.publish.mockRejectedValue(Object.assign(new Error("Menu placement target was not found"), { code: "E_NOT_FOUND" }));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await developer.installDeveloperMenu();
  expect(api.getDeveloperMenuState()).toMatchObject({ status: "error", error: expect.objectContaining({ code: "E_NOT_FOUND" }) });
  expect(error).toHaveBeenCalled();
  error.mockRestore();
});
