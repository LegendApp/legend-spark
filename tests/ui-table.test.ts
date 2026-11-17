import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered }, View: "View", Text: "Text" }));
vi.mock("../packages/ui/src/table/TableNativeComponent", () => ({ default: "SparkTable" }));
import { Table as TableComponent, getTableAvailability } from "../packages/ui/src/table";
const Table = TableComponent as React.FC<any>;
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
const native = () => rendered.root.findByType("SparkTable").props;
const columns = [{ id: "subject", title: "Subject" }, { id: "date", title: "Date", width: 100, alignment: "trailing", monospacedDigits: true, secondary: true }] as const;
const rows = [{ id: "a", values: { subject: "First", date: "Nov 1" } }, { id: "b", values: { subject: "Second" } }];
const selection = (id: string, ids: string[]) => ({ nativeEvent: { id, idsJson: JSON.stringify(ids) } });

test("the table sends columns, rows and the parent's selection, and snaps back a selection the parent keeps", async () => {
  const onSelectionChange = vi.fn(), onDoubleClick = vi.fn();
  await mount(React.createElement(Table, { columns, rows, selectedId: "a", onSelectionChange, onDoubleClick, alternatingRows: true, rowHeight: 24 }));
  expect(JSON.parse(native().columnsJson)).toEqual(columns);
  expect(JSON.parse(native().rowsJson)).toEqual(rows);
  expect(native()).toMatchObject({ selectedIdsJson: '["a"]', allowsMultipleSelection: false, headerVisible: true, alternatingRows: true, rowHeight: 24, selectionRevision: 0 });
  await act(async () => native().onTableSelectionChange(selection("b", ["b"])));
  expect(onSelectionChange).toHaveBeenCalledWith({ id: "b", ids: ["b"] });
  expect(native()).toMatchObject({ selectedIdsJson: '["a"]', selectionRevision: 1 });
  await act(async () => native().onTableSelectionChange(selection("", [])));
  expect(onSelectionChange).toHaveBeenLastCalledWith({ id: null, ids: [] });
  await act(async () => native().onTableDoubleClick({ nativeEvent: { id: "b" } }));
  await act(async () => native().onTableDoubleClick({ nativeEvent: { id: "gone" } }));
  expect(onDoubleClick.mock.calls).toEqual([[{ id: "b" }]]);
});

test("selectedIds turns on multiple selection; rows a newer render removed are dropped, and malformed events are E_INVALID_DATA", async () => {
  const onSelectionChange = vi.fn(), onError = vi.fn();
  await mount(React.createElement(Table, { columns, rows, selectedIds: ["a", "b"], onSelectionChange, onError, headerVisible: false }));
  expect(native()).toMatchObject({ selectedIdsJson: '["a","b"]', allowsMultipleSelection: true, headerVisible: false });
  await act(async () => native().onTableSelectionChange(selection("x", ["a", "x"])));
  expect(onSelectionChange).toHaveBeenCalledWith({ id: "a", ids: ["a"] });
  expect(onError).not.toHaveBeenCalled();
  await act(async () => native().onTableSelectionChange({ nativeEvent: { id: "a", idsJson: "[1]" } }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
});

test("invalid table options throw, and other platforms render the rows as text and report E_UNSUPPORTED_PLATFORM", async () => {
  const valid = { columns, rows, selectedId: null, onSelectionChange: vi.fn() };
  for (const props of [{ columns: [] }, { columns: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }, { columns: [{ id: "a", title: "A", width: 10, minWidth: 20 }] }, { columns: [{ id: "a", title: "A", alignment: "left" }] },
    { rows: [rows[0], rows[0]] }, { rows: [{ id: "c", values: { other: "x" } }] }, { rows: [{ id: "c", values: { subject: 1 } }] }, { rowHeight: 0 }, { selectedId: undefined }, { selectedIds: ["a"] }, { onSelectionChange: undefined }, { headerVisible: "no" }]) {
    await expect(mount(React.createElement(Table, { ...valid, ...props } as never))).rejects.toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  await expect(mount(React.createElement(Table, { ...valid, columns: [{ id: "a", title: "A", sortable: true }] } as never))).rejects.toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  platform.OS = "windows"; const onError = vi.fn();
  expect(getTableAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await mount(React.createElement(Table, { ...valid, onError }));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(rendered.root.findAllByType("SparkTable")).toHaveLength(0);
  expect(rendered.root.findAllByType("Text").map((node: any) => node.props.children)).toEqual(["First  Nov 1", "Second  "]);
});
