import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Native = { token: number; title: string; visible: boolean; bounds: { displayId: string; x: number; y: number; width: number; height: number } };
type Listener = { id: string; token: number; type: string; listener: (event: object) => void; removed: boolean };
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  tabbing: true,
  windows: new Map<string, Native>(),
  token: 0,
  listeners: [] as Listener[],
  /** Tab groups as the native layer reports them: window IDs in tab order and the selected one. */
  groups: [] as { windowIds: string[]; selectedWindowId: string | null }[],
  displays: [
    { id: "1", persistentId: "built-in", name: "Built-in", primary: true, size: { width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 }, scaleFactor: 2 },
    { id: "2", persistentId: "studio", name: "Studio", primary: false, size: { width: 2560, height: 1440 }, workArea: { x: 0, y: 25, width: 2560, height: 1415 }, scaleFactor: 2 },
  ],
  openWindow: vi.fn(), closeWindow: vi.fn(), showWindow: vi.fn(), selectWindowTab: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: mocks.platform, NativeModules: {},
  AppRegistry: { registerComponent: () => {} },
  UIManager: { hasViewManagerConfig: () => false },
  StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
  View: "View", Text: "Text", Pressable: "Pressable", useColorScheme: () => "light",
}));
const failure = (code: string) => Object.assign(new Error(code), { code });
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: (option?: string) => option === "tabbing" && !mocks.tabbing ? { available: false, reason: "unsupported-platform" } : { available: true },
  openWindow: mocks.openWindow, closeWindow: mocks.closeWindow, showWindow: mocks.showWindow, selectWindowTab: mocks.selectWindowTab,
  getWindow: async (id: string) => {
    const window = mocks.windows.get(id);
    if (!window) throw failure("E_NOT_FOUND");
    // Like AppKit, a background tab is not visible.
    const background = mocks.groups.some(group => group.windowIds.includes(id) && group.selectedWindowId !== id);
    return { id, title: window.title, visible: window.visible && !background, focused: false, bounds: { ...window.bounds } };
  },
  getDisplays: async () => mocks.displays,
  listWindowTabGroups: async () => {
    if (!mocks.tabbing) throw failure("E_UNSUPPORTED_PLATFORM");
    const grouped = new Set(mocks.groups.flatMap(group => group.windowIds));
    return [...mocks.groups, ...[...mocks.windows.keys()].filter(id => !grouped.has(id)).map(id => ({ windowIds: [id], selectedWindowId: id }))];
  },
  setWindowOptions: vi.fn(), handleWindowNewTab: vi.fn(),
  addWindowListener: async (id: string, type: string, listener: (event: object) => void) => {
    const window = mocks.windows.get(id);
    if (!window) throw failure("E_NOT_FOUND");
    const entry: Listener = { id, token: window.token, type, listener, removed: false };
    mocks.listeners.push(entry);
    return { remove: async () => { entry.removed = true; } };
  },
}));
vi.mock("../packages/desktop-windows/src/macos", () => ({ addMacOSWindowListener: vi.fn() }));
import { createWindowMessages, createWindowState, createWindowsNavigator, getWindowSessionAvailability, type WindowSession, type WindowState } from "../packages/desktop-windows/src/windows";

const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const deliver = (id: string, type: string, event: object) => {
  const token = mocks.windows.get(id)?.token;
  for (const entry of [...mocks.listeners]) if (!entry.removed && entry.id === id && entry.token === token && entry.type === type) entry.listener({ windowId: id, ...event });
};
const live = (type: string) => mocks.listeners.filter(entry => !entry.removed && entry.type === type).map(entry => entry.id);
const removers: Array<() => unknown> = [];
function track<T extends { remove(): unknown }>(value: T) { removers.push(() => value.remove()); return value; }
const Note = (_: { title: string }) => null;
type View = { route: string; scrollY: number; selected: number | null; split: number };
let views!: WindowState<View>;
const config = { note: { component: Note }, settings: { id: "session-settings", component: () => null } };
let names = 0;
/** Each test registers its own entry names: window roots stay registered for the process. */
function navigator() {
  const suffix = ++names;
  return track(createWindowsNavigator({ [`note${suffix}`]: config.note, [`settings${suffix}`]: { ...config.settings, id: `session-settings-${suffix}` } })) as any;
}

beforeEach(() => {
  mocks.platform.OS = "macos"; mocks.tabbing = true; mocks.windows.clear(); mocks.listeners = []; mocks.groups = [];
  views = track(createWindowState<View>({ initial: () => ({ route: "document", scrollY: 0, selected: null, split: 200 }), restorationKey: "note-view" }));
  mocks.openWindow.mockReset().mockImplementation(async (options: any) => {
    if (mocks.windows.has(options.id)) throw failure("E_ALREADY_EXISTS");
    const display = mocks.displays.find(item => item.id === options.position?.displayId) ?? mocks.displays[0];
    let bounds = { displayId: display.id, x: options.position?.x ?? 100, y: options.position?.y ?? 100, width: options.size?.width ?? 640, height: options.size?.height ?? 480 };
    if (options.tabbedWith) {
      bounds = { ...mocks.windows.get(options.tabbedWith)!.bounds };
      const group = mocks.groups.find(item => item.windowIds.includes(options.tabbedWith));
      if (group) { group.windowIds.push(options.id); group.selectedWindowId = options.id; }
      else mocks.groups.push({ windowIds: [options.tabbedWith, options.id], selectedWindowId: options.id });
    }
    mocks.windows.set(options.id, { token: ++mocks.token, title: options.title ?? "", visible: options.show !== false, bounds });
    return { id: options.id };
  });
  mocks.closeWindow.mockReset().mockImplementation(async (id: string) => {
    if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND");
    void Promise.resolve().then(() => { deliver(id, "closed", {}); mocks.windows.delete(id); });
    return { closed: true };
  });
  mocks.showWindow.mockReset().mockImplementation(async (id: string) => { if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND"); });
  mocks.selectWindowTab.mockReset().mockImplementation(async (id: string) => { const group = mocks.groups.find(item => item.windowIds.includes(id)); if (group) group.selectedWindowId = id; });
});
afterEach(async () => { for (const remove of removers.splice(0).reverse()) await remove(); });

test("a session saves each window's entry, props, title, frame, restorable state, tab groups and key window, and restores them exactly", async () => {
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "Note 1" }, options: { title: "Note 1" } });
  const two = await windows.openInstance(note, { props: { title: "Note 2" }, options: { title: "Note 2", tabbedWith: one.id } });
  const three = await windows.openInstance(note, { props: { title: "Note 3" }, options: { title: "Note 3", position: { displayId: "2", x: 300.5, y: 220 }, size: { width: 700, height: 520 } } });
  views.get(one).set({ route: "details", scrollY: 240, selected: 3, split: 260 });
  views.get(three).scrollY.set(80);
  mocks.selectWindowTab(one.id);
  deliver(one.id, "focusChanged", { focused: true });
  const session = await windows.getSession();
  expect(session).toEqual({
    version: 1,
    windows: [
      { id: one.id, name: note, props: { title: "Note 1" }, title: "Note 1", visible: true, bounds: { displayId: "1", x: 100, y: 100, width: 640, height: 480, persistentDisplayId: "built-in" }, state: { "note-view": { route: "details", scrollY: 240, selected: 3, split: 260 } } },
      { id: two.id, name: note, props: { title: "Note 2" }, title: "Note 2", visible: true, bounds: { displayId: "1", x: 100, y: 100, width: 640, height: 480, persistentDisplayId: "built-in" }, state: {} },
      { id: three.id, name: note, props: { title: "Note 3" }, title: "Note 3", visible: true, bounds: { displayId: "2", x: 300.5, y: 220, width: 700, height: 520, persistentDisplayId: "studio" }, state: { "note-view": { route: "document", scrollY: 80, selected: null, split: 200 } } },
    ],
    tabGroups: [{ windowIds: [one.id, two.id], selectedWindowId: one.id }],
    keyWindowId: one.id,
  });
  // The session is plain JSON: it survives storage.
  const stored = JSON.parse(JSON.stringify(session)) as WindowSession;
  for (const window of [one, two, three]) await window.close();
  await tick(); mocks.groups = [];
  expect(windows.list()).toEqual([]);

  const restored = await windows.restoreSession(stored);
  expect(restored.map((window: any) => window.id)).toEqual([one.id, two.id, three.id]);
  expect(restored[0]).not.toBe(one);
  // Saved IDs, props and titles; explicit frames; the second tab rejoins the first; the selected tab and key window come back.
  expect(mocks.openWindow.mock.calls.slice(-3).map(([options]) => ({ id: options.id, props: options.props.props, title: options.title, position: options.position, size: options.size, tabbedWith: options.tabbedWith }))).toEqual([
    { id: one.id, props: { title: "Note 1" }, title: "Note 1", position: { displayId: "1", x: 100, y: 100 }, size: { width: 640, height: 480 }, tabbedWith: undefined },
    { id: two.id, props: { title: "Note 2" }, title: "Note 2", position: undefined, size: { width: 640, height: 480 }, tabbedWith: one.id },
    { id: three.id, props: { title: "Note 3" }, title: "Note 3", position: { displayId: "2", x: 300.5, y: 220 }, size: { width: 700, height: 520 }, tabbedWith: undefined },
  ]);
  expect(mocks.groups).toEqual([{ windowIds: [one.id, two.id], selectedWindowId: one.id }]);
  expect(mocks.selectWindowTab).toHaveBeenLastCalledWith(one.id);
  expect(mocks.showWindow).toHaveBeenLastCalledWith(one.id, { focus: true });
  expect(views.get(restored[0]).peek()).toEqual({ route: "details", scrollY: 240, selected: 3, split: 260 });
  expect(views.get(restored[2]).scrollY.peek()).toBe(80);
  // Saving again gives the same session.
  deliver(one.id, "focusChanged", { focused: true });
  expect(await windows.getSession()).toEqual(stored);
  // A window saved without a value starts from initial().
  expect(views.get(restored[1]).peek()).toEqual({ route: "document", scrollY: 0, selected: null, split: 200 });
});

test("a tab group with no visible window is saved as hidden, ungrouped windows", async () => {
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "One" } });
  const two = await windows.openInstance(note, { props: { title: "Two" }, options: { tabbedWith: one.id } });
  for (const window of [one, two]) mocks.windows.get(window.id)!.visible = false;
  const session = await windows.getSession();
  expect(session.tabGroups).toEqual([]);
  expect(session.windows.map((window: { visible: boolean }) => window.visible)).toEqual([false, false]);
});

test("a saved state not created yet is kept, and a frame on a disconnected display moves into the primary display's work area", async () => {
  const windows = navigator(), note = `note${names}`;
  const session: WindowSession = { version: 1, keyWindowId: null, tabGroups: [], windows: [
    { id: "note-saved", name: note, props: { title: "Saved" }, title: "Saved", visible: false, state: { "lazy-module": { open: true } },
      bounds: { displayId: "9", persistentDisplayId: "projector", x: 1400, y: 900, width: 2000, height: 600 } },
  ] };
  const [window] = await windows.restoreSession(session);
  expect(mocks.openWindow.mock.calls[0][0]).toMatchObject({ id: "note-saved", show: false, position: { displayId: "1", x: 0, y: 382 }, size: { width: 1512, height: 600 } });
  expect((await windows.getSession()).windows[0].state).toEqual({ "lazy-module": { open: true } });
  // A state created later starts from its saved value.
  const lazy = track(createWindowState({ initial: () => ({ open: false }), restorationKey: "lazy-module" }));
  expect(lazy.get(window).open.peek()).toBe(true);
});

test("restoreSession validates the whole session before opening anything, and closes what it opened when a window fails", async () => {
  const windows = navigator(), note = `note${names}`, settings = `settings${names}`;
  const saved = (id: string, name = note) => ({ id, name, props: { title: id }, title: id, visible: true, state: {}, bounds: { displayId: "1", persistentDisplayId: "built-in", x: 10, y: 10, width: 400, height: 300 } });
  const reject = (session: unknown) => expect(windows.restoreSession(session as WindowSession));
  await reject({ version: 2, windows: [], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await reject({ version: 1, windows: [saved("a"), saved("a")], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await reject({ version: 1, windows: [saved("a", "gone")], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await reject({ version: 1, windows: [saved("other", settings)], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await reject({ version: 1, windows: [{ ...saved("a"), state: { bad: new Date() } }], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await reject({ version: 1, windows: [saved("a")], tabGroups: [{ windowIds: ["a"], selectedWindowId: null }], keyWindowId: null }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await reject({ version: 1, windows: [saved("a")], tabGroups: [], keyWindowId: "b" }).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(mocks.openWindow).not.toHaveBeenCalled();
  const open = await windows.openInstance(note, { props: { title: "x" } });
  await reject({ version: 1, windows: [saved(open.id)], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  expect(mocks.openWindow).toHaveBeenCalledTimes(1);
  // The second window fails natively: the first is closed again.
  mocks.openWindow.mockImplementationOnce(mocks.openWindow.getMockImplementation()!).mockImplementationOnce(async () => { throw failure("E_NATIVE"); });
  await reject({ version: 1, windows: [saved("a"), saved("b")], tabGroups: [], keyWindowId: null }).rejects.toMatchObject({ code: "E_NATIVE" });
  await tick();
  expect([...mocks.windows.keys()]).toEqual([open.id]);
});

test("Windows: sessions carry no tab groups, and tab groups and duplicate-as-tab reject E_UNSUPPORTED_OPTION", async () => {
  mocks.platform.OS = "windows"; mocks.tabbing = false;
  expect(getWindowSessionAvailability()).toEqual({ available: true });
  expect(getWindowSessionAvailability("tabs")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => getWindowSessionAvailability("other" as "tabs")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "One" } });
  const session = await windows.getSession();
  expect(session.tabGroups).toEqual([]);
  await expect(windows.duplicate(one, { tab: true })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await one.close(); await tick();
  await expect(windows.restoreSession({ ...session, tabGroups: [{ windowIds: [one.id, one.id], selectedWindowId: null }] })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const two = { ...session.windows[0], id: "note-two" };
  await expect(windows.restoreSession({ ...session, windows: [...session.windows, two], tabGroups: [{ windowIds: [one.id, two.id], selectedWindowId: null }] })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(mocks.openWindow).toHaveBeenCalledTimes(1);
  expect((await windows.restoreSession(session)).map((window: any) => window.id)).toEqual([one.id]);
});

test("duplicate opens the source's entry with its props, title and a cascaded frame; state is shared or copied, never aliased", async () => {
  const windows = navigator(), note = `note${names}`;
  const stars = track(createWindowState({ initial: () => ({ count: 0 }) }));
  const source = await windows.openInstance(note, { props: { title: "Source", doc: "a" }, options: { title: "Source", position: { displayId: "2", x: 2400, y: 40 }, size: { width: 400, height: 300 } } });
  views.get(source).set({ route: "details", scrollY: 120, selected: 2, split: 240 });
  stars.get(source).count.set(5); stars.promote(source, "pinned");

  const copy = await windows.duplicate(source);
  expect(copy.name).toBe(note); expect(copy.id).not.toBe(source.id);
  // Cascaded by 24 and kept inside the display's work area (x is clamped to 2560 - 400).
  expect(mocks.openWindow.mock.calls[1][0]).toMatchObject({ title: "Source", props: { props: { title: "Source", doc: "a" } }, position: { displayId: "2", x: 2160, y: 64 }, size: { width: 400, height: 300 } });
  expect(views.get(copy).peek()).toEqual({ route: "details", scrollY: 120, selected: 2, split: 240 });
  expect(views.get(copy)).not.toBe(views.get(source));
  views.get(copy).route.set("document");
  expect(views.get(source).route.peek()).toBe("details");
  // The app-scoped value stays shared: the duplicate is attached to it.
  expect(stars.getBinding(copy)).toBe("pinned");
  stars.get(copy).count.set(6); expect(stars.get(source).count.peek()).toBe(6);

  // Detached: a restorable attached value is copied, and nothing is shared.
  const shared = views.promote(source, "shared-view");
  const detached = await windows.duplicate(source, { detached: true, props: { title: "Detached" }, options: { title: "Detached" } });
  expect(mocks.openWindow.mock.calls[2][0]).toMatchObject({ title: "Detached", props: { props: { title: "Detached", doc: "a" } } });
  expect(views.getBinding(detached)).toBeNull();
  expect(views.get(detached).peek()).toEqual(shared.peek());
  views.get(detached).scrollY.set(1); expect(shared.scrollY.peek()).toBe(120);
  // Non-restorable values are never copied: a detached duplicate starts them from initial().
  expect(stars.getBinding(detached)).toBeNull(); expect(stars.get(detached).count.peek()).toBe(0);

  // As a tab of the source's group.
  const tab = await windows.duplicate(source, { tab: true });
  expect(mocks.openWindow.mock.calls[3][0]).toMatchObject({ tabbedWith: source.id }); expect(mocks.openWindow.mock.calls[3][0].position).toBeUndefined();
  expect(mocks.groups).toEqual([{ windowIds: [source.id, tab.id], selectedWindowId: tab.id }]);

  await expect(windows.duplicate(source, { mode: "x" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(windows.duplicate(source, { options: { id: "x" } } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const settings = await windows.openInstance(`settings${names}`);
  await expect(windows.duplicate(settings)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const other = navigator();
  await expect(other.duplicate(source)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await source.close(); await tick();
  await expect(windows.duplicate(source)).rejects.toMatchObject({ code: "E_CLOSED" });
  // A duplicate of a duplicate is attached to the same app value.
  expect(stars.getBinding(await windows.duplicate(copy))).toBe("pinned");
});

test("subscribeToSession coalesces changes and observes frames and tab groups only while it has listeners", async () => {
  const windows = navigator(), note = `note${names}`;
  const one = await windows.openInstance(note, { props: { title: "One" } });
  expect(live("boundsChanged")).toEqual([]);
  const changed = vi.fn();
  const subscription = windows.subscribeToSession(changed);
  await tick();
  expect(live("boundsChanged")).toEqual([one.id]); expect(live("tabGroupChanged")).toEqual([one.id]);
  deliver(one.id, "boundsChanged", {}); deliver(one.id, "boundsChanged", {}); deliver(one.id, "tabGroupChanged", {});
  await tick(); expect(changed).toHaveBeenCalledTimes(1);
  views.get(one).scrollY.set(10); views.get(one).split.set(300);
  await tick(); expect(changed).toHaveBeenCalledTimes(2);
  const two = await windows.openInstance(note, { props: { title: "Two" } });
  await tick(); expect(changed).toHaveBeenCalledTimes(3); expect(live("boundsChanged")).toEqual([one.id, two.id]);
  await two.close(); await tick();
  expect(changed).toHaveBeenCalledTimes(4); expect(live("boundsChanged")).toEqual([one.id]);
  subscription.remove(); await tick();
  expect(live("boundsChanged")).toEqual([]); expect(live("tabGroupChanged")).toEqual([]);
  views.get(one).scrollY.set(11); await tick();
  expect(changed).toHaveBeenCalledTimes(4);
});

test("messages: typed requests reach one window's handler; broadcasts reach every other listener", async () => {
  const windows = navigator(), note = `note${names}`;
  type Requests = { summary(payload: { verbose: boolean }): { title: string; verbose: boolean }; slow(payload: null): void; fail(payload: null): void };
  type Broadcasts = { highlight: { word: string } };
  const messages = track(createWindowMessages<Requests, Broadcasts>());
  const one = await windows.openInstance(note, { props: { title: "One" } }), two = await windows.openInstance(note, { props: { title: "Two" } });
  const handler = vi.fn((payload: { verbose: boolean }) => ({ title: "One", verbose: payload.verbose }));
  const handling = messages.handle(one, "summary", handler);
  expect(() => messages.handle(one, "summary", handler)).toThrow(expect.objectContaining({ code: "E_BUSY" }));
  await expect(messages.request(one, "summary", { verbose: true }, { from: two })).resolves.toEqual({ title: "One", verbose: true });
  expect(handler).toHaveBeenLastCalledWith({ verbose: true }, two);
  await expect(messages.request(one, "summary", { verbose: false })).resolves.toEqual({ title: "One", verbose: false });
  expect(handler).toHaveBeenLastCalledWith({ verbose: false }, null);
  await expect(messages.request(two, "summary", { verbose: true })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  messages.handle(one, "fail", () => { throw new Error("handler failed"); });
  await expect(messages.request(one, "fail", null)).rejects.toThrow("handler failed");
  // Timeout, and a window closing while a request is pending.
  vi.useFakeTimers();
  messages.handle(one, "slow", () => new Promise(() => {}));
  const timedOut = messages.request(one, "slow", null, { timeoutMs: 50 });
  const expectation = expect(timedOut).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(50); await expectation;
  vi.useRealTimers();
  const pending = messages.request(one, "slow", null);
  await expect(messages.request(one, "slow", null, { timeoutMs: 0 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  // Broadcasts: app listeners and window listeners; the sender's own listener is skipped; a throwing listener does not stop delivery.
  const app = vi.fn(), first = vi.fn(() => { throw new Error("listener failed"); }), second = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  messages.addListener("highlight", app);
  messages.addListener("highlight", first, { window: one });
  messages.addListener("highlight", second, { window: two });
  expect(messages.broadcast("highlight", { word: "hello" })).toBe(3);
  expect(second).toHaveBeenLastCalledWith({ word: "hello" }, null); expect(error).toHaveBeenCalledTimes(1);
  expect(messages.broadcast("highlight", { word: "from two" }, { from: two })).toBe(2);
  expect(second).toHaveBeenCalledTimes(1); expect(app).toHaveBeenLastCalledWith({ word: "from two" }, two);
  await one.close(); await tick();
  await expect(pending).rejects.toMatchObject({ code: "E_CLOSED" });
  await expect(messages.request(one, "summary", { verbose: true })).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(() => messages.handle(one, "summary", handler)).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  // The closed window's listener ended with it.
  expect(messages.broadcast("highlight", { word: "after" })).toBe(2);
  handling.remove();
  expect(() => messages.handle(two, "bad type!" as "summary", handler)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => messages.handle({ id: "x" } as never, "summary", handler)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  messages.handle(two, "slow", () => new Promise(() => {}));
  const removedWhilePending = messages.request(two, "slow", null);
  messages.remove();
  await expect(removedWhilePending).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(() => messages.broadcast("highlight", { word: "x" })).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  error.mockRestore();
  if (false) {
    // @ts-expect-error Payloads are typed per request.
    void messages.request(two, "summary", { verbose: "yes" });
    // @ts-expect-error Results are typed per request.
    const result: Promise<number> = messages.request(two, "summary", { verbose: true });
    // @ts-expect-error Broadcast payloads are typed.
    messages.broadcast("highlight", { words: 1 });
    void result;
  }
});

test("a duplicate whose app value was released before its first read fails instead of starting from initial()", async () => {
  const windows = navigator(), note = `note${names}`;
  const stars = track(createWindowState({ initial: () => ({ count: 0 }) }));
  const source = await windows.openInstance(note, { props: { title: "Source" } });
  stars.get(source).count.set(3); stars.promote(source, "released");
  const copy = await windows.duplicate(source);
  await source.close(); await tick();
  stars.release("released");
  expect(() => stars.get(copy)).toThrow(expect.objectContaining({ code: "E_NOT_FOUND" }));
  expect(() => stars.get(copy)).toThrow(expect.objectContaining({ code: "E_NOT_FOUND" }));
});
