import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } }));
import { createSettingsStore } from "../packages/settings/src/store";
import { createShortcutMap, useRoutedHotkeys, useShortcutMap, type HotkeyRouter, type ShortcutMap, type ShortcutMapSnapshot, type UseRoutedHotkeysOptions } from "../packages/commands/src/index";

let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) { await act(async () => rendered.unmount()); rendered = undefined; } vi.restoreAllMocks(); });

const files = new Map<string, string>();
const store = createSettingsStore({ storage: { read: async key => files.get(key), write: async (key, value) => { files.set(key, value); }, remove: async key => { files.delete(key); } } });

test("useShortcutMap renders map changes and unsubscribes on unmount without closing the map", async () => {
  const map = await createShortcutMap({ commands: [{ id: "save", title: "Save", defaultBindings: ["CmdOrCtrl+S"] }], store });
  const addListener = vi.spyOn(map, "addListener");
  const snapshots: ShortcutMapSnapshot[] = [];
  function View({ value }: { value: ShortcutMap<"save"> }) { snapshots.push(useShortcutMap(value)); return null; }
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(View, { value: map }))); });
  expect(snapshots.at(-1)!.commands[0].bindings).toEqual(["CmdOrCtrl+S"]);
  const renders = snapshots.length;
  await act(async () => { await map.rebind("save", ["CmdOrCtrl+Shift+S"]); });
  expect(snapshots.length).toBeGreaterThan(renders);
  expect(snapshots.at(-1)!.commands[0]).toMatchObject({ bindings: ["CmdOrCtrl+Shift+S"], customized: true });
  const subscription = addListener.mock.results.at(-1)!.value as { remove(): void };
  const remove = vi.spyOn(subscription, "remove");
  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(remove).toHaveBeenCalled();
  await expect(map.reset("save")).resolves.toMatchObject({ reason: "reset" }); // Still open: the caller owns it.
  await map.close();
});

test("useRoutedHotkeys switches changed bindings on the same registration", async () => {
  const register = vi.fn(), setBindings = vi.fn(async (_bindings: unknown) => {}), remove = vi.fn(async () => {});
  register.mockResolvedValue({ remove, setEnabled: vi.fn(async () => {}), setBindings });
  const router: HotkeyRouter = { register, suspend: vi.fn(), getPressedKeys: () => new Set(), setActiveWindowId() {} };
  const definitions = [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }];
  function Component(options: UseRoutedHotkeysOptions<string>) { useRoutedHotkeys(options); return null; }
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: {}, bindings: { open: ["Cmd+O"] } })); });
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: {}, bindings: { open: ["Cmd+P"] } })); });
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: {}, bindings: { open: ["Cmd+P"] } })); });
  expect(register).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
  expect(setBindings.mock.calls).toEqual([[{ open: ["Cmd+P"] }]]);
});

test("useRoutedHotkeys applies bindings that change while registration is pending", async () => {
  let resolve!: (value: unknown) => void;
  const setBindings = vi.fn(async (_bindings: unknown) => {}), register = vi.fn(() => new Promise(done => { resolve = done; }));
  const router = { register, suspend: vi.fn(), getPressedKeys: () => new Set(), setActiveWindowId() {} } as unknown as HotkeyRouter;
  const definitions = [{ id: "open", title: "Open", defaultBindings: ["Cmd+O"] }];
  function Component(options: UseRoutedHotkeysOptions<string>) { useRoutedHotkeys(options); return null; }
  await act(async () => { rendered = create(React.createElement(Component, { router, definitions, handlers: {} })); });
  await act(async () => { rendered.update(React.createElement(Component, { router, definitions, handlers: {}, bindings: { open: ["Cmd+P"] } })); });
  await act(async () => { resolve({ remove: vi.fn(async () => {}), setEnabled: vi.fn(async () => {}), setBindings }); });
  expect(register).toHaveBeenCalledOnce();
  expect(setBindings.mock.calls).toEqual([[{ open: ["Cmd+P"] }]]);
});
