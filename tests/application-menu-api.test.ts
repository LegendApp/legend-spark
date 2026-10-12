import { beforeEach, expect, test, vi } from "vitest";
import type { MenuFeature, MenuItem, MenuOptions, MenuRootItem } from "../packages/native-menu/src/api";
const state = vi.hoisted(() => ({ platform: { OS: "macos" }, installed: true, publish: vi.fn(), listeners: new Map<string, Set<(event: unknown) => void>>() }));
vi.mock("../packages/native-menu/src/NativeMenu", () => ({ get default() { return state.installed ? { publish: state.publish } : undefined; } }));
vi.mock("react-native", () => ({ Platform: state.platform, NativeEventEmitter: class {
  addListener(name: string, listener: (event: unknown) => void) {
    if (!state.listeners.has(name)) state.listeners.set(name, new Set());
    state.listeners.get(name)!.add(listener);
    return { remove() { state.listeners.get(name)!.delete(listener); } };
  }
} }));
const api = () => import("../packages/native-menu/src/api");
const root = (items: readonly MenuItem[] = []): MenuRootItem[] => [{ type: "submenu", id: "audit", label: "Audit", items }];
const wire = () => JSON.parse(state.publish.mock.calls.at(-1)![0]);
function emit(event: object) { for (const listener of state.listeners.get("NativeMenuLifecycle") ?? []) listener(event); }
beforeEach(() => { vi.resetModules(); state.platform.OS = "macos"; state.installed = true; state.publish.mockReset().mockResolvedValue(undefined); state.listeners.clear(); });

test("macOS snapshots alternates, mixed state, hidden items and SF Symbols without leaking local fields", async () => {
  const { createMenu } = await api();
  const menu = await createMenu({ id: "features", items: root([
    { type: "action", id: "open", label: "Open", shortcut: "Cmd+O", icon: { type: "symbol", name: "folder" } },
    { type: "action", id: "alternate", label: "Open Alternative", alternate: true, shortcut: "Cmd+Alt+O" },
    { type: "checkbox", id: "mixed", label: "Mixed", checked: "mixed" },
    { type: "action", id: "hidden", label: "Hidden", hidden: true },
  ]) });
  expect(wire()[0].items).toMatchObject([{ id: "open", systemImageName: "folder" }, { id: "alternate", alternate: true }, { id: "mixed", checked: false, mixed: true }]);
  await menu.update({ items: root([{ type: "checkbox", id: "mixed", label: "Mixed", checked: true }]) });
  expect(wire()[0].items[0]).toMatchObject({ checked: true });
  expect(wire()[0].items[0]).not.toHaveProperty("mixed");
  await menu.remove();
});

test("Help search registers a semantic root independently of its translated label", async () => {
  const { createMenu } = await api();
  const menu = await createMenu({ id: "help", items: [{ type: "submenu", id: "help", label: "مساعدة", target: { menu: "help" }, items: [] }] });
  expect(wire()[0]).toMatchObject({ title: "مساعدة", target: { menu: "help" } });
  await menu.remove();
});

test("lifecycle callbacks filter registration, submenu, type, and removed or replaced items", async () => {
  const { createMenu } = await api();
  const onOpen = vi.fn(), onClose = vi.fn();
  const menu = await createMenu({ id: "events", items: root([{ type: "action", id: "command", label: "Command" }]), onOpen, onClose });
  const ownerId = wire()[0]._sparkOwner;
  expect(wire()[0]._sparkLifecycle).toBe(true);
  expect(wire()[0].items[0]).not.toHaveProperty("_sparkLifecycle");
  for (const event of [{ ownerId: "other", itemId: "audit", type: "open" }, { ownerId, itemId: "command", type: "open" }, { ownerId, itemId: "audit", type: "invalid" }]) emit(event);
  expect(onOpen).not.toHaveBeenCalled();
  emit({ ownerId, itemId: "audit", type: "open" });
  emit({ ownerId, itemId: "audit", type: "close" });
  expect(onOpen).toHaveBeenCalledWith({ menuId: "audit" });
  expect(onClose).toHaveBeenCalledWith({ menuId: "audit" });
  await menu.update({ items: [] });
  emit({ ownerId, itemId: "audit", type: "open" });
  expect(onOpen).toHaveBeenCalledTimes(1);
  await menu.remove();
  expect(state.listeners.get("NativeMenuLifecycle")?.size).toBe(0);
});

test("lifecycle observers stop synchronously even when native cleanup fails and can retry", async () => {
  const { createMenu } = await api();
  const onOpen = vi.fn();
  const menu = await createMenu({ id: "cleanup", items: root(), onOpen });
  const ownerId = wire()[0]._sparkOwner;
  state.publish.mockRejectedValueOnce(Error("native cleanup"));
  const removal = menu.remove();
  emit({ ownerId, itemId: "audit", type: "open" });
  expect(onOpen).not.toHaveBeenCalled();
  await expect(removal).rejects.toMatchObject({ code: "E_NATIVE" });
  await menu.remove();
  expect(wire()).toEqual([]);
});

test("failed publication releases both listeners and owners without lifecycle callbacks allocate no lifecycle listener", async () => {
  const { createMenu } = await api();
  state.publish.mockRejectedValueOnce(Error("publication failed"));
  await expect(createMenu({ id: "failed", items: root(), onClose() {} })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect([...state.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  const menu = await createMenu({ id: "failed", items: root() });
  expect(state.listeners.get("NativeMenuLifecycle")?.size ?? 0).toBe(0);
  expect(wire()[0]).not.toHaveProperty("_sparkLifecycle");
  await menu.remove();
});

test("Windows reports feature support, rejects unsupported requests before native publication and merges the semantic Help root", async () => {
  state.platform.OS = "windows";
  const { createMenu, getMenuAvailability } = await api();
  expect(getMenuAvailability()).toEqual({ available: true });
  expect(getMenuAvailability("hiddenItems")).toEqual({ available: true });
  for (const feature of ["alternates", "lifecycle", "helpSearch", "mixedState", "icons"] as const) expect(getMenuAvailability(feature)).toEqual({ available: false, reason: "host-restriction" });
  const requests: MenuOptions[] = [
    { id: "alternate", items: root([{ type: "action", id: "x", label: "X", alternate: true }]) },
    { id: "mixed", items: root([{ type: "checkbox", id: "x", label: "X", checked: "mixed" }]) },
    { id: "icon", items: root([{ type: "action", id: "x", label: "X", icon: { type: "symbol", name: "folder" } }]) },
    { id: "lifecycle", items: root(), onOpen() {} },
  ];
  for (const request of requests) await expect(createMenu(request)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(state.publish).not.toHaveBeenCalled();
  const menu = await createMenu({ id: "hidden", items: root([{ type: "action", id: "x", label: "X", hidden: true }]) });
  expect(wire()[0].items).toEqual([]);
  await menu.remove();
  const base = await createMenu({ id: "base-help", items: [{ type: "submenu", id: "base-help", label: "Help", target: { menu: "help" }, items: [{ type: "action", id: "about", label: "About" }] }] });
  const help = await createMenu({ id: "help", items: [{ type: "submenu", id: "app-help", label: "Help", target: { menu: "help" }, items: [{ type: "action", id: "guide", label: "Guide" }] }] });
  expect(wire()).toHaveLength(1);
  expect(wire()[0].items.map((item: { id: string }) => item.id)).toEqual(["about", "guide"]);
  await help.remove();
  await base.remove();
});

test("alternates must directly follow a visible non-alternate command with the same key and different modifiers", async () => {
  const { createMenu } = await api();
  const open = { type: "action", id: "open", label: "Open", shortcut: "Cmd+O" } as const;
  const alternate = (fields: Partial<Extract<MenuItem, { type: "action" }>> = {}): MenuItem => ({ type: "action", id: "open-all", label: "Open All", shortcut: "Cmd+Alt+O", alternate: true, ...fields });
  const invalid: [string, MenuItem[]][] = [
    ["must directly follow", [alternate()]],
    ["must directly follow", [open, { type: "separator" }, alternate()]],
    ["must directly follow", [{ type: "submenu", id: "recent", label: "Recent", items: [] }, alternate()]],
    ["must directly follow", [open, alternate(), alternate({ id: "open-other", shortcut: "Cmd+Shift+O" })]],
    ["must directly follow", [{ ...open, hidden: true }, alternate()]],
    ["must directly follow", [open, { type: "separator" }, { type: "action", id: "hidden", label: "Hidden", hidden: true }, alternate()]],
    ["target or placement", [open, alternate({ placement: { before: { id: "open" } } })]],
    ["target or placement", [{ ...open, target: { role: "open" } }, alternate()]],
    ["target or placement", [{ ...open, placement: { after: { id: "x" } } }, alternate()]],
    ["same shortcut key", [open, alternate({ shortcut: "Cmd+Alt+P" })]],
    ["same shortcut key", [open, alternate({ shortcut: undefined })]],
    ["same shortcut key", [{ ...open, shortcut: undefined }, alternate()]],
    ["different shortcut modifiers", [open, alternate({ shortcut: "Cmd+O" })]],
    ["different shortcut modifiers", [{ type: "submenu", id: "nested", label: "Nested", items: [open, alternate({ shortcut: "Command+O" })] }]],
  ];
  for (const [message, items] of invalid) await expect(createMenu({ id: "alternates", items: root(items) }), message).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT", message: expect.stringContaining(message) });
  expect(state.publish).not.toHaveBeenCalled();
  const menu = await createMenu({ id: "alternates", items: root([
    open, { type: "action", id: "hidden", label: "Hidden", hidden: true }, alternate(),
    { type: "role", id: "close", role: "close" }, { type: "action", id: "close-all", label: "Close All", alternate: true },
    { type: "checkbox", id: "wrap", label: "Wrap", checked: false, shortcut: "Cmd+W" }, { type: "checkbox", id: "wrap-all", label: "Wrap All", checked: "mixed", shortcut: "Cmd+Shift+W", alternate: true },
  ]) });
  expect(wire()[0].items.map((item: { id: string; alternate?: boolean }) => [item.id, item.alternate ?? false])).toEqual([["open", false], ["open-all", true], ["close", false], ["close-all", true], ["wrap", false], ["wrap-all", true]]);
  await menu.remove();
});

test("feature availability is truthful for macOS, absent modules, and unsupported platforms", async () => {
  const { createMenu, getMenuAvailability } = await api();
  for (const feature of ["alternates", "lifecycle", "helpSearch", "mixedState", "icons", "hiddenItems"] as const) expect(getMenuAvailability(feature)).toEqual({ available: true });
  expect(() => getMenuAvailability("misspelled" as MenuFeature)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  state.installed = false;
  expect(getMenuAvailability("lifecycle")).toEqual({ available: false, reason: "missing-module" });
  await expect(createMenu({ id: "missing", items: root(), onOpen() {} })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  state.platform.OS = "ios";
  expect(getMenuAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(createMenu({ id: "missing", items: root() })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});

test("extension validation preserves malformed-input and cyclic-tree errors", async () => {
  const { createMenu } = await api();
  const requests = [
    { items: root([{ type: "action", id: "x", label: "X", alternate: "yes" } as never]) },
    { items: root([{ type: "checkbox", id: "x", label: "X", checked: "invalid" } as never]) },
    { items: root(), onOpen: true },
    { items: [{ type: "submenu", id: "x", label: "X", items: [], target: "invalid" }] },
  ];
  const cyclic: MenuItem[] = []; cyclic.push({ type: "submenu", id: "x", label: "X", items: cyclic });
  requests.push({ items: cyclic as MenuRootItem[] });
  for (const request of requests) await expect(createMenu({ id: "invalid", ...request } as MenuOptions)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(state.publish).not.toHaveBeenCalled();
});


test("lifecycle updates retain observation only after successful publication and isolate observer exceptions", async () => {
  const { createMenu } = await api();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const onOpen = vi.fn(() => { throw Error("observer failure"); }), onClose = vi.fn();
  const menu = await createMenu({ id: "update-events", items: root(), onOpen, onClose });
  const ownerId = wire()[0]._sparkOwner;
  state.publish.mockRejectedValueOnce(Error("update failed"));
  await expect(menu.update({ items: [] })).rejects.toMatchObject({ code: "E_NATIVE" });
  emit({ ownerId, itemId: "audit", type: "open" });
  emit({ ownerId, itemId: "audit", type: "close" });
  expect(onOpen).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "E_NATIVE", message: "Menu lifecycle handler failed" }));
  await menu.update({ items: root([{ type: "submenu", id: "nested", label: "Nested", items: [] }]) });
  expect(wire()[0]._sparkLifecycle).toBe(true);
  expect(wire()[0].items[0]._sparkLifecycle).toBe(true);
  emit({ ownerId, itemId: "nested", type: "close" });
  expect(onClose).toHaveBeenLastCalledWith({ menuId: "nested" });
  await menu.remove();
  error.mockRestore();
});

test("invalid top-level options reject with SparkError before observing or publishing", async () => {
  const { createMenu } = await api();
  for (const options of [null, undefined, false, []]) await expect(createMenu(options as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(state.listeners.size).toBe(0);
  expect(state.publish).not.toHaveBeenCalled();
});
