import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Native = { token: number; title: string; visible: boolean; fullscreen: boolean; bounds: { displayId: string; x: number; y: number; width: number; height: number } };
type Listener = { id: string; token: number; type: string; listener: (event: object) => void; removed: boolean };
type Display = { id: string; persistentId: string | null; name: string; primary: boolean; size: { width: number; height: number }; workArea: { x: number; y: number; width: number; height: number }; scaleFactor: number };
const builtIn: Display = { id: "1", persistentId: "built-in", name: "Built-in", primary: true, size: { width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 }, scaleFactor: 2 };
const studio: Display = { id: "2", persistentId: "studio", name: "Studio", primary: false, size: { width: 2560, height: 1440 }, workArea: { x: 0, y: 25, width: 2560, height: 1415 }, scaleFactor: 2 };
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  turbo: new Set(["NativeDesktopFileSystem"]),
  windows: new Map<string, Native>(),
  token: 0,
  listeners: [] as Listener[],
  displays: [] as Display[],
  files: new Map<string, string>(),
  vetoes: new Set<string>(),
  menus: [] as { id: string; items: any[]; onAction: (action: { type: "action"; itemId: string }) => void; removed: boolean }[],
  openWindow: vi.fn(), closeWindow: vi.fn(), showWindow: vi.fn(), setWindowFullscreen: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: mocks.platform, NativeModules: {},
  TurboModuleRegistry: { get: (name: string) => mocks.turbo.has(name) ? {} : null },
  AppRegistry: { registerComponent: () => {} },
  UIManager: { hasViewManagerConfig: () => false },
  StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
  View: "View", Text: "Text", Pressable: "Pressable", useColorScheme: () => "light",
}));
const failure = (code: string) => Object.assign(new Error(code), { code });
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => mocks.platform.OS === "macos" || mocks.platform.OS === "windows" ? { available: true } : { available: false, reason: "unsupported-platform" },
  openWindow: mocks.openWindow, closeWindow: mocks.closeWindow, showWindow: mocks.showWindow, setWindowFullscreen: mocks.setWindowFullscreen,
  selectWindowTab: vi.fn(), setWindowOptions: vi.fn(), handleWindowNewTab: vi.fn(), listWindowTabGroups: async () => [],
  getWindow: async (id: string) => {
    const window = mocks.windows.get(id);
    if (!window) throw failure("E_NOT_FOUND");
    return { id, title: window.title, visible: window.visible, focused: false, fullscreen: window.fullscreen, bounds: { ...window.bounds } };
  },
  getDisplays: async () => mocks.displays.map(display => ({ ...display })),
  addWindowListener: async (id: string, type: string, listener: (event: object) => void) => {
    const window = mocks.windows.get(id);
    if (!window) throw failure("E_NOT_FOUND");
    const entry: Listener = { id, token: window.token, type, listener, removed: false };
    mocks.listeners.push(entry);
    return { remove: async () => { entry.removed = true; } };
  },
}));
vi.mock("../packages/desktop-windows/src/macos", () => ({ addMacOSWindowListener: vi.fn() }));
vi.mock("@legendapp/spark-file-system", () => ({
  getDirectory: async (kind: string) => `/Container/${kind}`,
  mkdir: async () => {},
  readText: async (path: string) => { const text = mocks.files.get(path); if (text === undefined) throw failure("E_NOT_FOUND"); return text; },
  writeText: async (path: string, text: string) => { mocks.files.set(path, text); },
  remove: async (path: string) => { if (!mocks.files.delete(path)) throw failure("E_NOT_FOUND"); },
}));
vi.mock("@legendapp/spark-native-menu", () => ({
  createMenu: async (options: { id: string; items: any[]; onAction: any }) => {
    const menu = { ...options, removed: false };
    mocks.menus.push(menu);
    return { id: options.id, update: async ({ items }: { items: any[] }) => { menu.items = items; }, remove: async () => { menu.removed = true; } };
  },
}));
import { createWindowWorkspaces, createWindowsNavigator, getWindowWorkspaceAvailability } from "../packages/desktop-windows/src/windows";

const FILE = "/Container/data/workspaces.json";
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const deliver = (id: string, type: string, event: object) => {
  const token = mocks.windows.get(id)?.token;
  for (const entry of [...mocks.listeners]) if (!entry.removed && entry.id === id && entry.token === token && entry.type === type) entry.listener({ windowId: id, ...event });
};
const removers: Array<() => unknown> = [];
function track<T extends { remove(): unknown }>(value: T) { removers.push(() => value.remove()); return value; }
let names = 0;
function navigator() {
  const suffix = ++names;
  return track(createWindowsNavigator({ [`note${suffix}`]: { component: (_: { title: string }) => null } })) as any;
}
const frames = () => Object.fromEntries([...mocks.windows].map(([id, window]) => [id, window.bounds]));

beforeEach(() => {
  mocks.platform.OS = "macos"; mocks.turbo = new Set(["NativeDesktopFileSystem"]); mocks.windows.clear(); mocks.listeners = []; mocks.files.clear(); mocks.vetoes.clear(); mocks.menus = [];
  mocks.displays = [builtIn, studio];
  mocks.openWindow.mockReset().mockImplementation(async (options: any) => {
    if (mocks.windows.has(options.id)) throw failure("E_ALREADY_EXISTS");
    const display = mocks.displays.find(item => item.id === options.position?.displayId) ?? mocks.displays[0]!;
    const bounds = { displayId: display.id, x: options.position?.x ?? 100, y: options.position?.y ?? 100, width: options.size?.width ?? 640, height: options.size?.height ?? 480 };
    mocks.windows.set(options.id, { token: ++mocks.token, title: options.title ?? "", visible: options.show !== false, fullscreen: false, bounds });
    return { id: options.id };
  });
  mocks.closeWindow.mockReset().mockImplementation(async (id: string) => {
    if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND");
    if (mocks.vetoes.has(id)) return { closed: false, reason: "vetoed" };
    void Promise.resolve().then(() => { deliver(id, "closed", {}); mocks.windows.delete(id); });
    return { closed: true };
  });
  mocks.showWindow.mockReset().mockResolvedValue(undefined);
  mocks.setWindowFullscreen.mockReset().mockImplementation(async (id: string, enabled: boolean) => { mocks.windows.get(id)!.fullscreen = enabled; });
});
afterEach(async () => { for (const remove of removers.splice(0).reverse()) await remove(); });

async function layout() {
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "One" }, options: { title: "One", position: { displayId: "1", x: 0, y: 38 }, size: { width: 756, height: 944 } } });
  const two = await windows.openInstance(note, { props: { title: "Two" }, options: { title: "Two", position: { displayId: "2", x: 1280, y: 25 }, size: { width: 1280, height: 1415 } } });
  return { windows, note, one, two, workspaces: track(await createWindowWorkspaces(windows)) };
}

test("availability: macOS with the file-system module; Windows and other platforms are typed unsupported", async () => {
  expect(getWindowWorkspaceAvailability()).toEqual({ available: true });
  mocks.turbo.clear();
  expect(getWindowWorkspaceAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(createWindowWorkspaces(navigator())).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  mocks.platform.OS = "windows";
  expect(getWindowWorkspaceAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(createWindowWorkspaces(navigator())).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  mocks.platform.OS = "macos"; mocks.turbo.add("NativeDesktopFileSystem");
  await expect(createWindowWorkspaces({} as any)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(createWindowWorkspaces(navigator(), { extra: true } as any)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(createWindowWorkspaces(navigator(), { menu: {} } as any)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("save writes a versioned file in the app's data directory; saving a name again replaces it in place", async () => {
  const { one, two, workspaces } = await layout();
  const changes = vi.fn();
  workspaces.subscribe(changes);
  const saved = await workspaces.save("Coding");
  expect(saved).toMatchObject({ name: "Coding", fullscreenWindowIds: [], displays: [
    { id: "1", persistentId: "built-in", primary: true, workArea: builtIn.workArea },
    { id: "2", persistentId: "studio", primary: false, workArea: studio.workArea },
  ] });
  expect(saved.session.windows.map(window => [window.id, window.bounds])).toEqual([
    [one.id, { displayId: "1", x: 0, y: 38, width: 756, height: 944, persistentDisplayId: "built-in" }],
    [two.id, { displayId: "2", x: 1280, y: 25, width: 1280, height: 1415, persistentDisplayId: "studio" }],
  ]);
  const file = JSON.parse(mocks.files.get(FILE)!);
  expect(file).toEqual({ version: 1, workspaces: [saved] });
  await workspaces.save("Writing");
  mocks.windows.get(one.id)!.fullscreen = true;
  await workspaces.save("Coding");
  expect((await workspaces.list()).map(item => [item.name, item.fullscreenWindowIds])).toEqual([["Coding", [one.id]], ["Writing", []]]);
  expect(changes).toHaveBeenCalledTimes(3);
  for (const name of ["", " Padded", "a\nb", "x".repeat(101)]) await expect(workspaces.save(name)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("restore closes the navigator's windows and reopens the workspace exactly on the same displays", async () => {
  const { windows, note, one, two, workspaces } = await layout();
  await workspaces.save("Coding");
  const before = frames();
  await one.close();
  const other = await windows.openInstance(note, { props: { title: "Other" } });
  await tick();
  const result = await workspaces.restore("Coding");
  await tick();
  expect(result).toMatchObject({ restored: true, placements: [{ windowId: one.id, displayId: "1", layout: "exact" }, { windowId: two.id, displayId: "2", layout: "exact" }] });
  expect(result.restored && result.windows.map(window => window.id)).toEqual([one.id, two.id]);
  expect(other.isOpen()).toBe(false);
  expect(frames()).toEqual(before);
  await expect(workspaces.restore("Missing")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("restore adapts the layout to the displays connected now", async () => {
  const { one, two, workspaces } = await layout();
  await workspaces.save("Desk");
  // The studio display is gone: its window keeps its place and proportions in the built-in display's work area.
  mocks.displays = [builtIn];
  let result = await workspaces.restore("Desk");
  await tick();
  expect(result).toMatchObject({ restored: true, placements: [{ windowId: one.id, layout: "exact" }, { windowId: two.id, displayId: "1", layout: "scaled" }] });
  expect(mocks.windows.get(two.id)!.bounds).toEqual({ displayId: "1", x: 756, y: 38, width: 756, height: 944 });
  // Another display of the studio's size takes its windows at the same place.
  const other = { ...studio, id: "7", persistentId: "other-studio", primary: false };
  mocks.displays = [builtIn, other];
  result = await workspaces.restore("Desk");
  await tick();
  expect(result).toMatchObject({ restored: true, placements: [{ windowId: one.id, layout: "exact" }, { windowId: two.id, displayId: "7", layout: "moved" }] });
  expect(mocks.windows.get(two.id)!.bounds).toEqual({ displayId: "7", x: 1280, y: 25, width: 1280, height: 1415 });
  // The built-in display at another resolution scales its window too; the saved primary goes to the primary display.
  mocks.displays = [{ ...builtIn, workArea: { x: 0, y: 30, width: 1200, height: 770 } }, studio];
  result = await workspaces.restore("Desk");
  await tick();
  expect(result).toMatchObject({ restored: true, placements: [{ windowId: one.id, displayId: "1", layout: "scaled" }, { windowId: two.id, layout: "exact" }] });
  expect(mocks.windows.get(one.id)!.bounds).toEqual({ displayId: "1", x: 0, y: 30, width: 600, height: 770 });
});

test("restore checks the saved session before closing anything, and stops at a vetoed close", async () => {
  const { one, two, workspaces } = await layout();
  await workspaces.save("Desk");
  // An app version whose navigator no longer has the saved entry: nothing closes.
  const later = navigator(), open = await later.openInstance(`note${names}`, { props: { title: "Open" } });
  const fresh = track(await createWindowWorkspaces(later));
  await expect(fresh.restore("Desk")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect(open.isOpen()).toBe(true);
  expect(mocks.closeWindow).not.toHaveBeenCalled();

  mocks.vetoes.add(two.id);
  await expect(workspaces.restore("Desk")).resolves.toEqual({ restored: false, reason: "vetoed", windowId: two.id });
  await tick();
  expect(one.isOpen()).toBe(false);
  expect(two.isOpen()).toBe(true);
});

test("fullscreen windows enter fullscreen again; a failure closes the restored windows", async () => {
  const { one, workspaces } = await layout();
  mocks.windows.get(one.id)!.fullscreen = true;
  await workspaces.save("Focus");
  await workspaces.restore("Focus");
  expect(mocks.setWindowFullscreen).toHaveBeenCalledWith(one.id, true);
  mocks.setWindowFullscreen.mockRejectedValueOnce(failure("E_UNSUPPORTED_OPTION"));
  await expect(workspaces.restore("Focus")).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await tick();
  expect(mocks.windows.size).toBe(0);
});

test("a corrupt or unknown-version file rejects E_INVALID_DATA until it is cleared", async () => {
  const { workspaces } = await layout();
  await workspaces.save("Desk");
  const valid = mocks.files.get(FILE)!;
  const corrupt = async (text: string) => {
    mocks.files.set(FILE, text);
    const fresh = track(await createWindowWorkspaces(navigator()));
    await expect(fresh.list()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
    await expect(fresh.save("Other")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
    expect(mocks.files.get(FILE)).toBe(text);
    return fresh;
  };
  await corrupt("{ not json");
  await corrupt(JSON.stringify({ version: 2, workspaces: [] }));
  await corrupt(JSON.stringify({ version: 1 }));
  const edit = (change: (file: any) => void) => { const file = JSON.parse(valid); change(file); return JSON.stringify(file); };
  await corrupt(edit(file => { file.workspaces[0].session.windows[0].bounds.width = "wide"; }));
  await corrupt(edit(file => { file.workspaces[0].session.windows[0].bounds.displayId = "99"; }));
  await corrupt(edit(file => { file.workspaces[0].fullscreenWindowIds = ["nope"]; }));
  await corrupt(edit(file => { file.workspaces.push(file.workspaces[0]); }));
  const fresh = await corrupt(edit(file => { file.workspaces[0].extra = true; }));
  await fresh.clear();
  expect(mocks.files.has(FILE)).toBe(false);
  expect(await fresh.list()).toEqual([]);
  await fresh.clear();
});

test("rename and delete", async () => {
  const { workspaces } = await layout();
  await workspaces.save("A"); await workspaces.save("B");
  await expect(workspaces.rename("A", "B")).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  await expect(workspaces.rename("Z", "Y")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await workspaces.rename("A", "C");
  await workspaces.delete("B");
  await expect(workspaces.delete("B")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect((await workspaces.list()).map(item => item.name)).toEqual(["C"]);
  await workspaces.remove();
  await expect(workspaces.list()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("the menu lists Save Workspace… and each workspace with its shortcut; its items save and restore", async () => {
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "One" } });
  const requestName = vi.fn().mockResolvedValueOnce("Morning").mockResolvedValueOnce(null);
  const onError = vi.fn();
  const workspaces = track(await createWindowWorkspaces(windows, { menu: { requestName, saveShortcut: "CmdOrCtrl+Alt+S", restoreShortcuts: ["Ctrl+CmdOrCtrl+1"] }, onError }));
  const menu = mocks.menus[0]!;
  const submenu = () => menu.items[0].items[0];
  expect(menu.items[0]).toMatchObject({ type: "submenu", label: "Window", target: { menu: "window" } });
  expect(submenu()).toMatchObject({ label: "Workspaces", items: [{ type: "action", id: "spark-workspaces-save", label: "Save Workspace…", shortcut: "CmdOrCtrl+Alt+S" }] });
  menu.onAction({ type: "action", itemId: "spark-workspaces-save" });
  await tick(); await tick();
  expect(submenu().items).toEqual([
    { type: "action", id: "spark-workspaces-save", label: "Save Workspace…", shortcut: "CmdOrCtrl+Alt+S" },
    { type: "separator" },
    { type: "action", id: "spark-workspaces-restore-0", label: "Morning", shortcut: "Ctrl+CmdOrCtrl+1" },
  ]);
  menu.onAction({ type: "action", itemId: "spark-workspaces-save" }); // Cancelled: nothing saved.
  await one.close(); await tick();
  menu.onAction({ type: "action", itemId: "spark-workspaces-restore-0" });
  await tick(); await tick();
  expect(windows.list().map((window: { id: string }) => window.id)).toEqual([one.id]);
  expect((await workspaces.list()).length).toBe(1);
  expect(onError).not.toHaveBeenCalled();
  await workspaces.remove();
  expect(menu.removed).toBe(true);
});
