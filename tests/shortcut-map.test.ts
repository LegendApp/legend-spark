import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A model of AppKit's ordering: the keyboard manager's local monitor consumes keys that match its
// published rules (then JavaScript routes them); unconsumed keys reach menu key equivalents.
const native = vi.hoisted(() => ({
  platform: { OS: "macos" as string },
  rules: [] as { key: string; modifiers: number; windowIds?: readonly string[] }[],
  down: new Set<(event: any) => void>(), up: new Set<(event: any) => void>(),
  publish: vi.fn(async (_rules: unknown) => {}),
  globals: new Map<object, { accelerator: string; handler: () => void }>(),
  registerGlobal: vi.fn(async (_accelerator: string) => {}), removeGlobal: vi.fn(async (_accelerator: string) => {}),
  keyboardAvailable: true,
}));
vi.mock("react-native", () => ({ Platform: native.platform, TurboModuleRegistry: { get: () => null } }));
vi.mock("@legendapp/spark-desktop-shortcuts/src/keyboard-manager", async () => {
  const { SparkError } = await import("../packages/desktop-app/src/contracts");
  const available = () => { if (native.platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Low-level keyboard monitoring requires a macOS host"); };
  return {
    getKeyboardAvailability: () => native.platform.OS === "macos" ? { available: true } : { available: false, reason: "unsupported-platform" },
    addKeyboardListener: async (type: "down" | "up", listener: (event: any) => void) => { available(); native[type].add(listener); return { async remove() { native[type].delete(listener); } }; },
    createKeyboardConsumption: async (rules: any) => {
      available(); await native.publish(rules); native.rules = rules;
      return { async update(next: any) { await native.publish(next); native.rules = next; }, async remove() { native.rules = []; } };
    },
  };
});
vi.mock("@legendapp/spark-global-shortcuts", async () => {
  const { setShortcutInventory } = await import("../packages/desktop-app/src/contracts/shortcut-inventory");
  const { parseAccelerator } = await import("../packages/desktop-app/src/contracts/accelerator");
  return {
    getGlobalShortcutAvailability: () => ({ available: true }),
    async registerGlobalShortcut(accelerator: string, handler: () => void) {
      await native.registerGlobal(accelerator);
      const registration = { async remove() { setShortcutInventory(registration, []); native.globals.delete(registration); await native.removeGlobal(accelerator); } };
      native.globals.set(registration, { accelerator, handler });
      setShortcutInventory(registration, [{ accelerator: parseAccelerator(accelerator, "macos"), owner: { source: "global-shortcut" } }]);
      return registration;
    },
  };
});
import { createSettingsStore } from "../packages/settings/src/store";
import { parseAccelerator, formatAccelerator } from "../packages/desktop-app/src/contracts/accelerator";
import { setShortcutInventory } from "../packages/desktop-app/src/contracts/shortcut-inventory";
import { createShortcutMap, getReservedShortcuts, getShortcutMapAvailability, type ShortcutCommand } from "../packages/commands/src/shortcut-map";
import { createHotkeyRouter } from "../packages/commands/src/router";

const lenient = { allowUnmodifiedCharacter: true, allowExtendedKeys: true };
const pressedKey = (binding: string) => formatAccelerator(parseAccelerator(binding, "macos", lenient));
let menuItems: any[] = [];
const menuActions = new Map<string, () => void>();
/** Presses a binding in `windowId` and reports whether the keyboard manager consumed it. */
function press(binding: string, windowId: string | null = "main") {
  const { key, modifiers } = parseAccelerator(binding, "macos", lenient);
  const consumed = native.rules.some(rule => rule.key === key && rule.modifiers === modifiers && (!rule.windowIds || (windowId !== null && rule.windowIds.includes(windowId))));
  const event = { key, keyCode: 0, modifiers, windowId, repeated: false, consumed, captured: false };
  if (consumed) for (const listener of native.down) listener(event);
  else {
    const visit = (items: any[]): any => items.flatMap(item => item.items ? visit(item.items) : item.shortcut && pressedKey(item.shortcut) === pressedKey(binding) ? [item] : []);
    for (const item of visit(menuItems)) menuActions.get(item.id)?.();
  }
  for (const listener of native.up) listener(event);
  return consumed;
}
function memoryStore(initial?: unknown) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set("shortcut-map", JSON.stringify(initial));
  const write = vi.fn(async (key: string, value: string) => { files.set(key, value); });
  const store = createSettingsStore({ storage: { read: async key => files.get(key), write, remove: async key => { files.delete(key); } } });
  return { store, files, write, saved: () => JSON.parse(files.get("shortcut-map")!) };
}
const commands = [
  { id: "new-note", title: "New note", defaultBindings: ["CmdOrCtrl+N"] },
  { id: "find", title: "Find", defaultBindings: ["CmdOrCtrl+F"], scope: "window" },
  { id: "bold", title: "Bold", defaultBindings: ["CmdOrCtrl+B"], scope: "view" },
  { id: "capture", title: "Quick capture", defaultBindings: ["CmdOrCtrl+Shift+F17"], scope: "global" },
] as const satisfies readonly ShortcutCommand[];
type Id = typeof commands[number]["id"];

beforeEach(() => {
  native.platform.OS = "macos"; native.rules = []; native.publish.mockReset(); native.registerGlobal.mockReset(); native.removeGlobal.mockReset();
  menuItems = []; menuActions.clear(); native.globals.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("persistence", () => {
  it("round-trips user overrides through settings storage as version 2", async () => {
    const { store, saved } = memoryStore();
    const map = await createShortcutMap({ commands, store });
    await map.rebind("new-note", ["CommandOrControl+Shift+N", "cmdorctrl+shift+n", "Alt+N"]);
    await map.unbind("find");
    expect(saved()).toEqual({ version: 2, overrides: { "new-note": ["CmdOrCtrl+Shift+N", "Alt+N"], find: [] } });
    await map.close();
    const reopened = await createShortcutMap({ commands, store });
    const bindings = Object.fromEntries(reopened.getSnapshot().commands.map(command => [command.id, command.bindings]));
    expect(bindings).toEqual({ "new-note": ["CmdOrCtrl+Shift+N", "Alt+N"], find: [], bold: ["CmdOrCtrl+B"], capture: ["CmdOrCtrl+Shift+F17"] });
    expect(reopened.getSnapshot().commands.map(command => command.customized)).toEqual([true, true, false, false]);
    await reopened.reset("find");
    expect(saved()).toEqual({ version: 2, overrides: { "new-note": ["CmdOrCtrl+Shift+N", "Alt+N"] } });
    await reopened.rebind("new-note", ["CmdOrCtrl+N"]); // Rebinding to the defaults follows future default changes.
    expect(saved()).toEqual({ version: 2, overrides: {} });
  });
  it("migrates version 1 full binding lists to overrides and writes version 2", async () => {
    const { store, saved, write } = memoryStore({ version: 1, bindings: { "new-note": ["CmdOrCtrl+N"], find: ["Cmd+G"], bold: [], removed: ["Cmd+R"] } });
    const map = await createShortcutMap({ commands, store });
    expect(saved()).toEqual({ version: 2, overrides: { find: ["Cmd+G"], bold: [] } });
    expect(write).toHaveBeenCalledOnce();
    expect(map.getSnapshot().commands.find(command => command.id === "capture")!.bindings).toEqual(["CmdOrCtrl+Shift+F17"]);
  });
  it("rejects unsupported versions and invalid stored bindings without touching the bytes", async () => {
    for (const value of [{ version: 3, overrides: {} }, { bindings: {} }, null, { version: 2, overrides: { find: ["Cmd+Nope"] } }, { version: 2, overrides: { find: "Cmd+G" } }, { version: 2, overrides: { find: ["Cmd+Tab"] } }]) {
      const { store, files, write } = memoryStore(value);
      await expect(createShortcutMap({ commands, store })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
      expect(files.get("shortcut-map")).toBe(JSON.stringify(value)); expect(write).not.toHaveBeenCalled();
    }
  });
});

describe("validation and conflicts", () => {
  it("validates with the shared parser and rejects or warns about reserved shortcuts", async () => {
    const map = await createShortcutMap({ commands, store: memoryStore().store });
    expect(() => map.validate("new-note", "Cmd+Nope")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
    expect(() => map.validate("capture", "K")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" })); // Global hotkeys need a modifier.
    expect(() => map.validate("capture", "Cmd+Home")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
    expect(map.validate("new-note", "K").binding).toBe("K"); // Commands allow unmodified keys.
    await expect(map.rebind("new-note", ["CmdOrCtrl+Tab"])).rejects.toMatchObject({ code: "E_BUSY" });
    expect(() => map.validate("ghost" as Id, "Cmd+K")).toThrow(expect.objectContaining({ code: "E_NOT_FOUND" }));
    const warned = await map.rebind("new-note", ["Cmd+Space"]);
    expect(warned.snapshot.conflicts).toEqual([{ commandId: "new-note", scope: "application", binding: "Cmd+Space", with: { source: "system", scope: "system", reserved: { accelerator: "Cmd+Space", platform: "macos", severity: "warning", description: "Spotlight" } } }]);
    await expect(createShortcutMap({ commands: [{ id: "x", title: "X", defaultBindings: ["Cmd+Shift+Q"] }], store: memoryStore().store })).rejects.toMatchObject({ code: "E_BUSY" });
  });
  it("documents per-platform reserved lists", () => {
    expect(getReservedShortcuts("macos").filter(entry => entry.severity === "reserved").map(entry => entry.accelerator)).toEqual(["Cmd+Tab", "Cmd+Shift+Tab", "Cmd+Alt+Escape", "Cmd+Ctrl+Q", "Cmd+Shift+Q"]);
    expect(getReservedShortcuts("windows").find(entry => entry.accelerator === "Ctrl+Alt+Delete")).toMatchObject({ severity: "reserved" });
    expect(() => getReservedShortcuts("linux" as never)).toThrow();
  });
  it("names the other party and its scope for commands, shortcuts, global shortcuts and menus", async () => {
    const map = await createShortcutMap({ commands, store: memoryStore().store });
    const tokens = [{}, {}, {}, {}];
    setShortcutInventory(tokens[0], [{ accelerator: parseAccelerator("Cmd+N", "macos"), owner: { source: "shortcut" } }]);
    setShortcutInventory(tokens[1], [{ accelerator: parseAccelerator("Cmd+F", "macos"), owner: { source: "shortcut", windowId: "editor" } }]);
    setShortcutInventory(tokens[2], [{ accelerator: parseAccelerator("Cmd+B", "macos"), owner: { source: "global-shortcut" } }]);
    setShortcutInventory(tokens[3], [{ accelerator: parseAccelerator("Cmd+Shift+F17", "macos"), owner: { source: "menu", menuId: "app", itemId: "capture-item", path: ["Capture", "Capture Item"] } }]);
    try {
      await map.rebind("bold", ["CmdOrCtrl+B", "CmdOrCtrl+F"]);
      expect(map.getSnapshot().conflicts.map(({ commandId, binding, with: other }) => [commandId, binding, other])).toEqual([
        ["new-note", "CmdOrCtrl+N", { source: "shortcut", scope: "application" }],
        ["find", "CmdOrCtrl+F", { source: "command", scope: "view", commandId: "bold" }],
        ["find", "CmdOrCtrl+F", { source: "shortcut", scope: "window", windowId: "editor" }],
        ["bold", "CmdOrCtrl+B", { source: "global-shortcut", scope: "global" }],
        ["bold", "CmdOrCtrl+F", { source: "command", scope: "window", commandId: "find" }],
        ["bold", "CmdOrCtrl+F", { source: "shortcut", scope: "window", windowId: "editor" }],
        ["capture", "CmdOrCtrl+Shift+F17", { source: "menu", scope: "menu", menuId: "app", itemId: "capture-item", path: ["Capture", "Capture Item"] }],
      ]);
      expect(map.validate("new-note", "Cmd+F").conflicts.map(conflict => conflict.with.source)).toEqual(["command", "command", "shortcut"]);
    } finally { for (const token of tokens) setShortcutInventory(token, []); }
  });
  it("emits change events for edits and only for external changes that alter conflicts", async () => {
    const map = await createShortcutMap({ commands, store: memoryStore().store });
    const listener = vi.fn(), subscription = map.addListener(listener), token = {}, other = {};
    await map.rebind("find", ["Cmd+G"]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "rebind", commandIds: ["find"] }));
    setShortcutInventory(other, [{ accelerator: parseAccelerator("Cmd+Shift+F1", "macos"), owner: { source: "shortcut" } }]);
    expect(listener).toHaveBeenCalledTimes(1);
    const before = map.getSnapshot();
    setShortcutInventory(token, [{ accelerator: parseAccelerator("Cmd+G", "macos"), owner: { source: "shortcut" } }]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toMatchObject({ reason: "external", commandIds: [], snapshot: { conflicts: [{ commandId: "find", binding: "Cmd+G", with: { source: "shortcut", scope: "application" } }] } });
    expect(map.getSnapshot()).not.toBe(before);
    setShortcutInventory(other, []); // Unrelated: the snapshot keeps its identity.
    const current = map.getSnapshot(); setShortcutInventory(other, [{ accelerator: parseAccelerator("Cmd+Shift+F2", "macos"), owner: { source: "shortcut" } }]);
    expect(map.getSnapshot()).toBe(current);
    subscription.remove(); setShortcutInventory(token, []); setShortcutInventory(other, []);
    expect(listener).toHaveBeenCalledTimes(2);
    await map.reset();
  });
});

describe("attached menus", () => {
  it("treats an attached menu's command items as the command's own key equivalents", async () => {
    const map = await createShortcutMap({ commands, store: memoryStore().store });
    const listener = vi.fn(); map.addListener(listener);
    const token = {}, menu = { id: "app", update: vi.fn(async ({ items }: { items: any[] }) => {
      setShortcutInventory(token, items[0].items.map((item: any) => ({ accelerator: parseAccelerator(item.shortcut, "macos"), owner: { source: "menu", menuId: "app", itemId: item.id, path: ["File", item.id] } })));
    }) };
    await menu.update({ items: [{ items: [{ id: "new-note", shortcut: "CmdOrCtrl+N" }, { id: "print", shortcut: "CmdOrCtrl+F" }] }] });
    expect(map.getSnapshot().conflicts.map(conflict => [conflict.commandId, conflict.with.source])).toEqual([["new-note", "menu"], ["find", "menu"]]);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "external" }));
    const attachment = await map.attachMenu(menu as never, shortcut => ({ items: [{ type: "submenu", id: "file", label: "File", items: [{ id: "new-note", shortcut: shortcut("new-note") }, { id: "print", shortcut: "CmdOrCtrl+F" }] }] as never }));
    // Only the unrelated Print item still conflicts, and subscribers hear about the change.
    expect(map.getSnapshot().conflicts.map(conflict => [conflict.commandId, conflict.with])).toEqual([["find", { source: "menu", scope: "menu", menuId: "app", itemId: "print", path: ["File", "print"] }]]);
    expect(listener.mock.lastCall![0].snapshot).toBe(map.getSnapshot());
    await attachment.remove();
    expect(map.getSnapshot().conflicts).toHaveLength(2);
    expect(listener.mock.lastCall![0].snapshot.conflicts).toHaveLength(2);
    setShortcutInventory(token, []); await map.close();
  });
});

describe("live rebinding", () => {
  it("switches router dispatch and menu key equivalents so every keystroke fires exactly one binding", async () => {
    const storage = memoryStore(), fired: string[] = [];
    const map = await createShortcutMap({ commands, store: storage.store });
    await map.register({ handlers: { "new-note": event => { fired.push(`key:${event.binding}`); } } });
    // Menu items carry command IDs; their actions run the same command.
    const menu = { id: "app", update: vi.fn(async ({ items }: { items: any[] }) => { menuItems = items; }) };
    menuActions.set("new-note", () => fired.push("menu"));
    await map.attachMenu(menu as never, shortcut => ({ items: [{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "new-note", label: "New note", shortcut: shortcut("new-note") }] }] }));
    expect(menuItems[0].items[0].shortcut).toBe("CmdOrCtrl+N");
    const probes: { at: string; old: number; next: number }[] = [];
    const probe = (at: string) => {
      const count = (binding: string) => { const start = fired.length; press(binding); return fired.length - start; };
      probes.push({ at, old: count("Cmd+N"), next: count("Cmd+Shift+N") });
    };
    native.publish.mockImplementation(async () => { probe("publish"); });
    menu.update.mockImplementation(async ({ items }) => { probe("menu-before"); menuItems = items; probe("menu-after"); });
    storage.write.mockImplementationOnce(async (key, value) => { probe("store-before"); storage.files.set(key, value); probe("store-after"); });
    probe("start");
    await map.rebind("new-note", ["CmdOrCtrl+Shift+N"]);
    probe("end");
    for (const { at, old, next } of probes) expect(old + next, `exactly one binding fires at ${at}`).toBe(1);
    const switched = probes.findIndex(probe => probe.next === 1);
    expect(probes.slice(0, switched).every(probe => probe.old === 1)).toBe(true);
    expect(probes.slice(switched).every(probe => probe.next === 1)).toBe(true);
    expect(probes.map(probe => probe.at)).toEqual(["start", "publish", "menu-before", "menu-after", "store-before", "store-after", "publish", "end"]);
    expect(switched).toBe(6); // The switch happens at the commit, after the menu and settings accepted the change.
    expect(menuItems[0].items[0].shortcut).toBe("CmdOrCtrl+Shift+N");
    expect(native.rules.map(rule => rule.key)).toEqual(["n"]);
    expect(native.rules[0].modifiers).toBe((1 << 20) | (1 << 17));
  });
  it("rolls every surface back when a stage fails, keeping the old binding live throughout", async () => {
    const storage = memoryStore(), fired: string[] = [];
    const map = await createShortcutMap({ commands, store: storage.store });
    await map.register({ handlers: { "new-note": () => { fired.push("new-note"); } } });
    const menu = { id: "app", update: vi.fn(async ({ items }: { items: any[] }) => { menuItems = items; }) };
    await map.attachMenu(menu as never, shortcut => ({ items: [{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "new-note", label: "New", shortcut: shortcut("new-note") }] }] }));
    storage.write.mockRejectedValueOnce(Error("disk full"));
    await expect(map.rebind("new-note", ["CmdOrCtrl+Shift+N"])).rejects.toThrow("disk full");
    expect(menuItems[0].items[0].shortcut).toBe("CmdOrCtrl+N");
    expect(native.rules.map(rule => rule.modifiers)).toEqual([1 << 20]);
    press("Cmd+N"); press("Cmd+Shift+N");
    expect(fired).toEqual(["new-note"]);
    expect(storage.files.has("shortcut-map")).toBe(false);
    expect(map.getSnapshot().commands[0].bindings).toEqual(["CmdOrCtrl+N"]);
  });
  it("routes application, window and view commands by priority and scope", async () => {
    const map = await createShortcutMap({ commands: [
      { id: "app", title: "App", defaultBindings: ["Cmd+K"] },
      { id: "window", title: "Window", defaultBindings: ["Cmd+K"], scope: "window" },
      { id: "view", title: "View", defaultBindings: ["Cmd+K"], scope: "view" },
    ], store: memoryStore().store });
    const fired: string[] = [];
    await expect(map.register({ handlers: { window: () => {} } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await map.register({ handlers: { app: event => { fired.push(`${event.commandId}:${event.scope}`); } } });
    const editor = await map.register({ windowId: "editor", handlers: { window: event => { fired.push(`${event.commandId}:${event.scope}`); }, view: event => { fired.push(`${event.commandId}:${event.scope}`); } } });
    press("Cmd+K", "editor"); press("Cmd+K", "other");
    await editor.remove(); press("Cmd+K", "editor");
    expect(fired).toEqual(["view:view", "app:application", "app:application"]);
  });
  it("switches global hotkeys at the commit with old and new registered in between", async () => {
    const storage = memoryStore(), fired: string[] = [];
    const map = await createShortcutMap({ commands, store: storage.store });
    const pressGlobal = (accelerator: string) => { const start = fired.length; for (const entry of native.globals.values()) if (pressedKey(entry.accelerator) === pressedKey(accelerator)) entry.handler(); return fired.length - start; };
    await map.register({ handlers: { capture: event => { fired.push(event.binding); } } });
    expect(map.getSnapshot().conflicts).toEqual([]); // The map's own hotkeys are not external conflicts.
    const probes: number[][] = [];
    const probe = () => probes.push([pressGlobal("Cmd+Shift+F17"), pressGlobal("Cmd+Shift+F18")]);
    native.registerGlobal.mockImplementation(async () => { probe(); });
    native.removeGlobal.mockImplementation(async () => { probe(); });
    storage.write.mockImplementationOnce(async (key, value) => { probe(); storage.files.set(key, value); probe(); });
    await map.rebind("capture", ["CmdOrCtrl+Shift+F18"]);
    probe();
    expect(probes).toEqual([[1, 0], [1, 0], [1, 0], [0, 1], [0, 1]]);
    expect([...native.globals.values()].map(entry => entry.accelerator)).toEqual(["CmdOrCtrl+Shift+F18"]);
    await map.close();
    expect(native.globals.size).toBe(0);
    await expect(map.rebind("capture", [])).rejects.toMatchObject({ code: "E_CLOSED" });
  });
  it("reports Windows dispatch as typed unsupported while the map, globals and persistence work", async () => {
    native.platform.OS = "windows";
    expect(getShortcutMapAvailability("application")).toEqual({ available: false, reason: "unsupported-platform" });
    expect(getShortcutMapAvailability("global")).toEqual({ available: true });
    const map = await createShortcutMap({ commands, store: memoryStore().store });
    await expect(map.register({ handlers: { "new-note": () => {} } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(map.rebind("new-note", ["Ctrl+Alt+Delete"])).rejects.toMatchObject({ code: "E_BUSY" });
    await expect(map.rebind("new-note", ["CmdOrCtrl+Tab"])).resolves.toMatchObject({ reason: "rebind" }); // Ctrl+Tab is not reserved on Windows.
    await map.register({ handlers: { capture: () => {} } });
    expect([...native.globals.values()].map(entry => entry.accelerator)).toEqual(["CmdOrCtrl+Shift+F17"]);
    await map.close();
  });
});

describe("router setBindings", () => {
  it("consumes old and new bindings while dispatching the old set, then publishes only the new set", async () => {
    const router = createHotkeyRouter(), fired: string[] = [];
    const registration = await router.register({ definitions: [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }], handlers: { open: context => { fired.push(context.binding); } } });
    const published: string[][] = [];
    native.publish.mockImplementation(async rules => {
      published.push((rules as { key: string }[]).map(rule => rule.key));
      press("Cmd+O"); press("Cmd+P"); // Probed against the rules still in effect natively.
    });
    await registration.setBindings({ open: ["Cmd+P"] });
    expect(published).toEqual([["o", "p"], ["p"]]);
    expect(fired).toEqual(["Cmd+O", "Cmd+P"]); // Old binding before the commit, new binding after it.
    press("Cmd+O"); press("Cmd+P");
    expect(fired).toEqual(["Cmd+O", "Cmd+P", "Cmd+P"]);
    await expect(registration.setBindings({ ghost: [] } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await registration.remove();
    await expect(registration.setBindings({ open: [] })).rejects.toMatchObject({ code: "E_CLOSED" });
  });
  it("rolls a failed staging publication back to the committed bindings", async () => {
    const router = createHotkeyRouter(), fired: string[] = [];
    const registration = await router.register({ definitions: [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }], handlers: { open: context => { fired.push(context.binding); } } });
    native.publish.mockRejectedValueOnce(Error("publish failed"));
    await expect(registration.setBindings({ open: ["Cmd+P"] })).rejects.toThrow("publish failed");
    expect(native.publish.mock.calls.at(-1)?.[0]).toMatchObject([{ key: "o" }]);
    press("Cmd+O"); press("Cmd+P");
    expect(fired).toEqual(["Cmd+O"]);
    await registration.remove();
  });
});
