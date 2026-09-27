import { expect, test, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null } }));
import { getHotkeyBindingConflicts, normalizeHotkeyFile, serializeHotkeyFile, type HotkeyDefinition } from "../packages/commands/src/bindings";
const definitions = [ { id: "open", title: "Open", defaultBindings: ["CmdOrCtrl+O"] }, { id: "save", title: "Save", defaultBindings: ["CmdOrCtrl+S"] } ] as const satisfies readonly HotkeyDefinition<string>[];
test("persistence has one strict versioned format, without legacy migration", () => {
  for (const value of [null, {}, { open: "⌥+S" }, { version: 2, bindings: {} }, { version: 1, bindings: { open: 0 } }, { version: 1, bindings: { open: ["Command+KeyO"] } }]) expect(() => normalizeHotkeyFile(value, definitions)).toThrow();
});
test("named bindings round-trip while retaining CommandOrControl portability", () => {
  const normalized = normalizeHotkeyFile({ version: 1, bindings: { open: ["CommandOrControl+O", "cmdorctrl+o"], save: ["Alt+S", "F19"] } }, definitions);
  expect(serializeHotkeyFile(normalized, definitions)).toEqual({ version: 1, bindings: { open: ["CmdOrCtrl+O"], save: ["Alt+S", "F19"] } });
});
test("missing commands use defaults and empty arrays explicitly disable", () => {
  expect(normalizeHotkeyFile({ version: 1, bindings: { open: [] } }, definitions)).toEqual({ version: 1, bindings: { open: [], save: ["CmdOrCtrl+S"] } });
  expect(normalizeHotkeyFile(undefined, definitions).bindings.open).toEqual(["CmdOrCtrl+O"]);
});
test("limits keep the first bindings and reject invalid limits", () => {
  expect(normalizeHotkeyFile({ version: 1, bindings: { open: ["A", "B"] } }, definitions, { maxBindingsPerCommand: 1 }).bindings.open).toEqual(["A"]);
  expect(() => normalizeHotkeyFile(undefined, definitions, { maxBindingsPerCommand: -1 })).toThrow();
});
test("conflict detection compares equivalent accelerator aliases on the active platform", () => {
  expect(getHotkeyBindingConflicts(definitions, { open: ["CommandOrControl+O"], save: ["Meta+O"] }).get("Cmd+O")).toEqual(["open", "save"]);
});

import { createHotkeyStore } from "../packages/commands/src/storage";
test("the consolidated store awaits decoding and saves canonical complete snapshots", async () => {
  let bytes: string | undefined = JSON.stringify({ version: 1, bindings: { open: ["CommandOrControl+P"] } });
  const storage = { read: async () => bytes, write: async (_: string, value: string) => { bytes = value; }, remove: async () => { bytes = undefined; } };
  const store = await createHotkeyStore({ definitions, path: "/hotkeys.json", storage, debounceMs: 0 });
  expect(store.value$.bindings.open.peek()).toEqual(["CmdOrCtrl+P"]);
  store.value$.bindings.save.set([]); await store.flush();
  expect(JSON.parse(bytes!)).toEqual({ version: 1, bindings: { open: ["CmdOrCtrl+P"], save: [] } });
  await store.close();
  bytes = JSON.stringify({ open: 0 });
  await expect(createHotkeyStore({ definitions, path: "/hotkeys.json", storage })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(bytes).toBe(JSON.stringify({ open: 0 }));
});
