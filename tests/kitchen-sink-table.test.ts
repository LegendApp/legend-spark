import { createRequire } from "node:module";
import React, { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", available: true }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", async () => {
  const { MESSAGES } = await import("../examples/kitchen-sink/shell/i18n");
  return { useI18n: () => ({ locale: state.locale, t: MESSAGES[state.locale], rtl: state.locale === "ar" }) };
});
vi.mock("@legendapp/spark/contracts", () => ({ SparkError: class SparkError extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("@legendapp/spark/ui", () => ({}));
vi.mock("@legendapp/spark/ui/table", async () => {
  const { SparkError } = await import("@legendapp/spark/contracts") as { SparkError: new (code: string, message: string) => Error };
  const view = (name: string) => (props: object) => {
    if (!state.available) throw new SparkError("E_UNSUPPORTED_PLATFORM", `${name} is unavailable`);
    return React.createElement(name, props);
  };
  return { Table: view("Table"), Outline: view("Outline"), getTableAvailability: () => state.available ? { available: true } : { available: false, reason: "unsupported-platform" } };
});
import { OutlineScreen, TableScreen } from "../examples/kitchen-sink/screens/native-controls/Table";

let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; state.locale = "en"; state.available = true; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(screen: React.ComponentType) { await act(async () => { rendered = create(React.createElement(screen)); }); }
const byID = (testID: string) => rendered.root.find((node: any) => typeof node.type === "string" && node.props.testID === testID);
const text = (testID: string) => byID(testID).props.children;
const count = (rows: { children?: readonly unknown[] }[]): number => rows.reduce((total, row) => total + 1 + (row.children ? count(row.children as never) : 0), 0);

test("Table and Outline are registered native-controls screens", async () => {
  vi.doMock("../examples/kitchen-sink/screens/native-controls/ControlPrimitives", () => ({ Buttons: () => null, Indicators: () => null, Inputs: () => null, Toggles: () => null, Boundary: () => null, describe: String }));
  for (const [file, names] of Object.entries({ Glass: ["Glass"], Pickers: ["Pickers"], Search: ["Search"], SFSymbols: ["SFSymbols"], Sidebar: ["SidebarDataItems", "SidebarDynamicHeights", "SidebarReactRows"], SplitView: ["SplitView"], PopoverScreen: ["PopoverScreen"], TabViewScreen: ["TabViewScreen"] })) {
    vi.doMock(`../examples/kitchen-sink/screens/native-controls/${file}`, () => Object.fromEntries(names.map(name => [name, () => null])));
  }
  const { default: registered } = await import("../examples/kitchen-sink/screens/native-controls/index");
  expect(registered.screens.filter(screen => [TableScreen, OutlineScreen].includes(screen.component as never)).map(screen => screen.id)).toEqual(["table", "outline"]);
});

test("the table holds 10,000 rows, sorts by the reported descriptors and keeps row objects", async () => {
  await mount(TableScreen);
  let table = byID("native-controls-table-list").props;
  expect(table.rows).toHaveLength(10_000);
  expect(table.rows[0]).toEqual({ id: "file-1", cells: { name: "File 1", kind: "Image", size: "7920 KB" } });
  expect(table).toMatchObject({ selectionMode: "multiple", selectedIds: ["file-2"], sort: [{ columnId: "name", direction: "ascending" }] });
  expect(table.columns.map((column: { id: string; title: string }) => column.title)).toEqual(["Name", "Kind", "Size"]);
  expect(text("native-controls-table-availability")).toBe('{"available":true}');
  const before = new Set(table.rows);
  await act(async () => table.onSortChange([{ columnId: "size", direction: "descending" }, { columnId: "name", direction: "ascending" }]));
  table = byID("native-controls-table-list").props;
  const sizes = table.rows.map((row: { cells: { size: string } }) => Number.parseInt(row.cells.size, 10));
  expect(sizes.every((size: number, index: number) => index === 0 || sizes[index - 1] >= size)).toBe(true);
  expect(table.rows.every((row: unknown) => before.has(row))).toBe(true);
  expect(text("native-controls-table-sort")).toBe('[{"columnId":"size","direction":"descending"},{"columnId":"name","direction":"ascending"}]');
  await act(async () => table.onSelectionChange(table.rows.map((row: { id: string }) => row.id)));
  expect(text("native-controls-table-selection")).toMatch(/^\{"count":10000,"first":\["file-\d+","file-\d+","file-\d+"\]\}$/);
  await act(async () => table.onColumnLayoutChange([{ id: "size", width: 90 }, { id: "name", width: 220 }, { id: "kind", width: 120 }]));
  expect(byID("native-controls-table-list").props.columnLayout).toEqual([{ id: "size", width: 90 }, { id: "name", width: 220 }, { id: "kind", width: 120 }]);
  await act(async () => table.onContextMenu({ rowId: "file-9", ids: ["file-9"], position: { x: 10.4, y: 20.6 } }));
  expect(text("native-controls-table-event")).toBe('{"contextMenu":{"rowId":"file-9","count":1,"first":["file-9"],"position":{"x":10,"y":21}}}');
  await act(async () => table.onActivate({ ids: ["file-3"] }));
  expect(text("native-controls-table-event")).toBe('{"activate":{"count":1,"first":["file-3"]}}');
});

test("the outline holds 10,010 rows in three levels with controlled expansion, in Arabic too", async () => {
  state.locale = "ar";
  await mount(OutlineScreen);
  const outline = byID("native-controls-outline-list").props;
  expect(count(outline.rows)).toBe(10_010);
  expect(outline.rows[0].cells).toEqual({ name: "مجموعة ١", kind: "مجموعة", size: "١٠ عنصر" });
  expect(outline.columns.map((column: { title: string; sortable?: boolean }) => [column.title, column.sortable])).toEqual([["الاسم", undefined], ["النوع", undefined], ["الحجم", undefined]]);
  expect(outline.expandedIds).toEqual(["group-1", "folder-1-1"]);
  await act(async () => outline.onExpandedChange(["group-1", "folder-1-1", "group-2"]));
  expect(text("native-controls-outline-expanded")).toBe('["group-1","folder-1-1","group-2"]');
  await act(async () => outline.onColumnLayoutChange([{ id: "name", width: 300 }]));
  expect(text("native-controls-outline-columns")).toBe('[{"id":"name","width":300}]');
});

test("an unavailable table shows its typed error in place of the view", async () => {
  state.available = false;
  await mount(TableScreen);
  expect(text("native-controls-table-availability")).toBe('{"available":false,"reason":"unsupported-platform"}');
  expect(text("native-controls-table-list-error")).toBe("SparkError:E_UNSUPPORTED_PLATFORM");
});
