import { expect, test } from "vitest";
import { bounds, jsonSnapshot, validateOptions } from "../packages/desktop-windows/src/validation";
import type { WindowOpenOptions } from "../packages/desktop-windows/src/types";
const base: WindowOpenOptions = { id: "editor", component: "Editor" };
test("window identities, creation-only fields and platform options reject before native effects", () => {
  for (const id of ["", "main", "../editor", "a".repeat(101)]) expect(() => validateOptions({ ...base, id }, "macos", true)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => validateOptions({ ...base }, "macos", false)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => validateOptions({ macos: { toolbar: { visible: true } } }, "windows", false)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => validateOptions({ titleBarStyle: "overlay" }, "windows", false)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
});
test("bounds accept negative display-relative positions but reject nonfinite or unsupported geometry", () => {
  expect(() => bounds({ displayId: "secondary", x: -200, y: 10, width: 640, height: 480 })).not.toThrow();
  for (const width of [99, 20001, NaN, Infinity]) expect(() => bounds({ displayId: "one", x: 0, y: 0, width, height: 400 })).toThrow();
  expect(() => bounds({ displayId: "one", x: 0, y: 0, width: 500, height: 400, scale: 2 })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
});
test("window sizes have consistent constraints, including explicit resets", () => {
  expect(() => validateOptions({ ...base, minSize: null, maxSize: null, size: { width: 100, height: 100 } }, "macos", true)).not.toThrow();
  expect(() => validateOptions({ ...base, minSize: { width: 700, height: 500 }, size: { width: 600, height: 600 } }, "macos", true)).toThrow();
  expect(() => validateOptions({ minSize: { width: 1000, height: 500 }, maxSize: { width: 900, height: 700 } }, "macos", false)).toThrow();
});
test("modal relationships require an ordinary window with a distinct parent", () => {
  for (const value of [{ modal: true }, { modal: true, parentId: "editor" }, { modal: true, parentId: "main", kind: "overlay" }]) expect(() => validateOptions({ ...base, ...value } as WindowOpenOptions, "macos", true)).toThrow();
  expect(() => validateOptions({ ...base, kind: "window", parentId: "main", modal: true }, "macos", true)).not.toThrow();
});
test("props are snapshotted without coercing invalid JSON values", () => {
  const source = { items: [{ count: 1 }], nullable: null }; const result = jsonSnapshot(source);
  source.items[0].count = 2; expect(result).toEqual({ items: [{ count: 1 }], nullable: null });
  const cyclic: any = {}; cyclic.self = cyclic;
  for (const props of [{ value: undefined }, { value: new Date() }, { value: NaN }, { value: new Array(2) }, cyclic, { [Symbol()]: 1 }]) expect(() => validateOptions({ ...base, props }, "macos", true)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
test("macOS groups reject unknown fields and conflicting level ownership", () => {
  expect(() => validateOptions({ alwaysOnTop: false, macos: { level: "normal" } }, "macos", false)).toThrow();
  expect(() => validateOptions({ macos: { titleBar: { typo: true } } } as never, "macos", false)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => validateOptions({ macos: { representedUri: "relative.txt" } }, "macos", false)).toThrow();
  expect(() => validateOptions({ macos: { representedUri: null, startupSplitView: null, titleBar: { controls: [] }, toolbar: { items: [] } } }, "macos", false)).not.toThrow();
});
test("toolbar menus use shared menu IDs and numeric slider values", () => {
  const options = { macos: { toolbar: { items: [{ type: "menu", id: "view", items: [{ type: "slider", id: "zoom", label: "Zoom", min: 1, max: 10, value: 5 }] }] } } } as const;
  expect(() => validateOptions(options, "macos", false)).not.toThrow();
  expect(() => validateOptions({ macos: { toolbar: { items: [{ type: "menu", id: "view", items: [{ type: "action", id: "a", label: "A", shortcut: "Cmd+A" }] }] } } } as unknown as Parameters<typeof validateOptions>[0], "macos", false)).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => validateOptions({ macos: { toolbar: { items: [{ type: "segmented", id: "view", value: "", segments: [{ value: "", label: "Empty" }, { value: "", label: "Duplicate" }] }] } } }, "macos", false)).toThrow();
});
