import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { platform, registered } = vi.hoisted(() => ({ platform: { OS: "macos", Version: "26.0" }, registered: vi.fn(() => true) }));
vi.mock("react-native", () => ({ Platform: platform, UIManager: { hasViewManagerConfig: registered } }));
vi.mock("../packages/ui/src/table/TableNativeComponent", () => ({ default: "SparkTable" }));
import { Outline, Table, getTableAvailability, type OutlineProps, type TableProps } from "../packages/ui/src/table";
import { ROW_CHUNK_SIZE, encodeColumns, encodeRows, type OutlineRow, type TableColumn, type TableRow } from "../packages/ui/src/table/model";

const columns: TableColumn[] = [
  { id: "name", title: "Name", width: 200, sortable: true },
  { id: "size", title: "Size", minWidth: 50, maxWidth: 160, alignment: "trailing", resizable: false, sortable: true },
];
const rows = (count: number, prefix = "r"): TableRow[] => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, cells: { name: `Row ${index}`, size: String(index) } }));
const tree: OutlineRow[] = [
  { id: "a", cells: { name: "A" }, children: [{ id: "a1", cells: { name: "A1" }, children: [{ id: "a1x", cells: { name: "A1x" } }] }, { id: "a2", cells: { name: "A2" } }] },
  { id: "b", cells: { name: "B" }, children: [] },
  { id: "c", cells: { name: "C" } },
];
let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; platform.OS = "macos"; platform.Version = "26.0"; registered.mockReturnValue(true);
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
const native = () => rendered.root.findByType("SparkTable").props;
const tableProps = (overrides: Partial<TableProps> = {}) => ({ columns, rows: rows(3), selectedIds: [], onSelectionChange: vi.fn(), sort: [], onSortChange: vi.fn(), ...overrides }) as TableProps;
const outlineProps = (overrides: Partial<OutlineProps> = {}) => ({ columns: [{ id: "name", title: "Name" }], rows: tree, selectionMode: "multiple", selectedIds: [], onSelectionChange: vi.fn(), expandedIds: ["a"], onExpandedChange: vi.fn(), ...overrides }) as OutlineProps;

test("availability is truthful per platform and rendering an unavailable table throws a typed error", async () => {
  expect(getTableAvailability()).toEqual({ available: true });
  expect(registered).toHaveBeenCalledWith("SparkTable");
  registered.mockReturnValue(false);
  expect(getTableAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(mount(React.createElement(Table, tableProps()))).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  platform.Version = "13.6"; registered.mockReturnValue(true);
  expect(getTableAvailability()).toEqual({ available: false, reason: "host-restriction" });
  platform.Version = "26.0";
  for (const os of ["windows", "ios", "android", "web"]) {
    platform.OS = os;
    expect(getTableAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(mount(React.createElement(Outline, outlineProps()))).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  }
});

test("a table supplies columns with defaults, chunked rows, selection, sort and native-owned layout", async () => {
  await mount(React.createElement(Table, tableProps({ rows: rows(600), selectionMode: "multiple", selectedIds: ["r1", "r4"], sort: [{ columnId: "size", direction: "descending" }], testID: "files" })));
  const props = native();
  expect(props).toMatchObject({ outline: false, selectionMode: "multiple", selectedIds: ["r1", "r4"], expandedIds: [], columnLayoutJson: "", columnReordering: true, eventCount: 0, testID: "files" });
  expect(JSON.parse(props.columnsJson)).toEqual([
    { id: "name", title: "Name", width: 200, minWidth: 24, maxWidth: 100000, resizable: true, sortable: true, alignment: "leading" },
    { id: "size", title: "Size", width: 120, minWidth: 50, maxWidth: 160, resizable: false, sortable: true, alignment: "trailing" },
  ]);
  expect(JSON.parse(props.sortJson)).toEqual([{ columnId: "size", ascending: false }]);
  expect(props.rowChunks).toHaveLength(Math.ceil(600 / ROW_CHUNK_SIZE));
  const parsed = props.rowChunks.flatMap((chunk: string) => JSON.parse(chunk));
  expect(parsed).toHaveLength(600);
  expect(parsed[599]).toEqual([0, 0, { id: "r599", cells: { name: "Row 599", size: "599" } }]);
});

test("rows are serialized once per row object; only chunks holding replaced rows change", () => {
  const encoded = encodeColumns(columns);
  expect(encoded.sortable).toEqual(new Set(["name", "size"]));
  const data = rows(1000);
  const stringify = vi.spyOn(JSON, "stringify");
  const first = encodeRows(data, false);
  expect(stringify).toHaveBeenCalledTimes(1000);
  stringify.mockClear();
  const again = encodeRows([...data], false);
  expect(stringify).not.toHaveBeenCalled();
  expect(again.chunks).toEqual(first.chunks);
  const edited = [...data]; edited[600] = { id: "r600", cells: { name: "Edited" } };
  const changed = encodeRows(edited, false);
  expect(stringify).toHaveBeenCalledTimes(1);
  expect(changed.chunks.map((chunk, index) => chunk === first.chunks[index])).toEqual([true, true, false, true]);
  // A sort reorders cached row JSON without serializing any row again.
  stringify.mockClear();
  encodeRows([...edited].reverse(), false);
  expect(stringify).not.toHaveBeenCalled();
});

test("outline rows flatten in display order with depth and expandability", () => {
  const encoded = encodeRows(tree, true);
  expect(encoded.chunks.flatMap(chunk => JSON.parse(chunk)).map(([depth, expandable, row]: [number, number, { id: string }]) => [depth, expandable, row.id])).toEqual([
    [0, 1, "a"], [1, 1, "a1"], [2, 0, "a1x"], [1, 0, "a2"], [0, 1, "b"], [0, 0, "c"],
  ]);
  expect(encoded.expandable).toEqual(new Set(["a", "a1", "b"]));
});

test("invalid columns, rows and controlled state are rejected before reaching native", async () => {
  const cases: [Partial<TableProps> | Partial<OutlineProps>, string, boolean?][] = [
    [{ columns: [] }, "E_INVALID_ARGUMENT"],
    [{ columns: [columns[0]!, { ...columns[0]! }] }, "E_INVALID_ARGUMENT"],
    [{ columns: [{ ...columns[0]!, hidden: true } as TableColumn] }, "E_UNSUPPORTED_OPTION"],
    [{ columns: [{ id: "n", title: "N", width: 10, minWidth: 20 }] }, "E_INVALID_ARGUMENT"],
    [{ columns: [{ id: "n", title: "N", alignment: "left" as never }] }, "E_INVALID_ARGUMENT"],
    [{ rows: [...rows(2), rows(1)[0]!] }, "E_INVALID_ARGUMENT"],
    [{ rows: [{ id: "x", cells: { name: 1 as never } }] }, "E_INVALID_ARGUMENT"],
    [{ rows: [{ id: "x\uD800", cells: {} }] }, "E_INVALID_ARGUMENT"],
    [{ rows: [{ id: "x", cells: {}, extra: 1 } as TableRow] }, "E_UNSUPPORTED_OPTION"],
    [{ rows: [{ id: "x", cells: {}, children: [] } as TableRow] }, "E_UNSUPPORTED_OPTION"],
    [{ selectedIds: ["missing"] }, "E_INVALID_ARGUMENT"],
    [{ selectedIds: ["r0", "r1"] }, "E_INVALID_ARGUMENT"],
    [{ selectionMode: "none", selectedIds: ["r0"] } as never, "E_INVALID_ARGUMENT"],
    [{ onSelectionChange: undefined }, "E_INVALID_ARGUMENT"],
    [{ sort: undefined, onSortChange: undefined }, "E_INVALID_ARGUMENT"],
    [{ columns: [{ id: "name", title: "Name" }], sort: [{ columnId: "name", direction: "ascending" }] }, "E_INVALID_ARGUMENT"],
    [{ sort: [{ columnId: "name", direction: "up" as never }] }, "E_INVALID_ARGUMENT"],
    [{ columnLayout: [{ id: "name", width: 100 }] } as never, "E_INVALID_ARGUMENT"],
    [{ columnLayout: [{ id: "size", width: 500 }], onColumnLayoutChange: vi.fn() }, "E_INVALID_ARGUMENT"],
    [{ columnLayout: [{ id: "gone", width: 100 }], onColumnLayoutChange: vi.fn() }, "E_INVALID_ARGUMENT"],
    [{ expandedIds: [] } as never, "E_UNSUPPORTED_OPTION"],
    [{ expandedIds: ["c"] }, "E_INVALID_ARGUMENT", true],
    [{ onExpandedChange: undefined } as never, "E_INVALID_ARGUMENT", true],
  ];
  for (const [overrides, code, outline] of cases) {
    const element = outline ? React.createElement(Outline, outlineProps(overrides as Partial<OutlineProps>)) : React.createElement(Table, tableProps(overrides as Partial<TableProps>));
    await expect(mount(element), JSON.stringify(Object.keys(overrides))).rejects.toMatchObject({ code });
  }
});

test("native changes reach callbacks once and are always acknowledged, accepted or not", async () => {
  const onSelectionChange = vi.fn(), onSortChange = vi.fn(), onColumnLayoutChange = vi.fn(), onError = vi.fn();
  await mount(React.createElement(Table, tableProps({ selectionMode: "multiple", onSelectionChange, onSortChange, onColumnLayoutChange, onError })));
  await act(async () => native().onTableSelectionChange({ nativeEvent: { ids: ["r0", "r2", "removed"], eventCount: 1 } }));
  expect(onSelectionChange).toHaveBeenCalledWith(["r0", "r2"]);
  // The parent kept its selection; the echoed count lets native restore it.
  expect(native()).toMatchObject({ selectedIds: [], eventCount: 1 });
  await act(async () => native().onTableSelectionChange({ nativeEvent: { ids: ["r1"], eventCount: 1 } }));
  expect(onSelectionChange).toHaveBeenCalledTimes(1);
  await act(async () => native().onTableSortChange({ nativeEvent: { sortJson: '[{"columnId":"size","ascending":true},{"columnId":"name","ascending":false}]', eventCount: 2 } }));
  expect(onSortChange).toHaveBeenCalledWith([{ columnId: "size", direction: "ascending" }, { columnId: "name", direction: "descending" }]);
  await act(async () => native().onTableColumnLayoutChange({ nativeEvent: { layoutJson: '[{"id":"size","width":80},{"id":"name","width":210}]', eventCount: 3 } }));
  expect(onColumnLayoutChange).toHaveBeenCalledWith([{ id: "size", width: 80 }, { id: "name", width: 210 }]);
  expect(native().eventCount).toBe(3);
  // Malformed native data is reported, still acknowledged, and never reaches callbacks.
  await act(async () => native().onTableSortChange({ nativeEvent: { sortJson: '[{"columnId":"kind","ascending":true}]', eventCount: 4 } }));
  await act(async () => native().onTableColumnLayoutChange({ nativeEvent: { layoutJson: "{", eventCount: 5 } }));
  await act(async () => native().onTableSelectionChange({ nativeEvent: { ids: ["r0"], eventCount: 0 } }));
  await act(async () => native().onTableError({ nativeEvent: { message: "Invalid table row JSON" } }));
  expect(onError.mock.calls.map(([error]) => [error.code, error.message])).toEqual([
    ["E_INVALID_DATA", "Invalid native sort descriptor"], ["E_INVALID_DATA", "Invalid native column layout"],
    ["E_INVALID_DATA", "Invalid native table event"], ["E_INVALID_DATA", "Invalid table row JSON"],
  ]);
  expect(onSortChange).toHaveBeenCalledTimes(1); expect(native().eventCount).toBe(5);
});

test("a controlled column layout reaches native and requires its callback", async () => {
  const onColumnLayoutChange = vi.fn();
  await mount(React.createElement(Table, tableProps({ columnLayout: [{ id: "size", width: 60 }], onColumnLayoutChange, columnReordering: false })));
  expect(JSON.parse(native().columnLayoutJson)).toEqual([{ id: "size", width: 60 }]);
  expect(native().columnReordering).toBe(false);
});

test("activation and context menus report rows by ID", async () => {
  const onActivate = vi.fn(), onContextMenu = vi.fn();
  await mount(React.createElement(Table, tableProps({ onActivate, onContextMenu })));
  await act(async () => native().onTableActivate({ nativeEvent: { ids: ["r1"] } }));
  await act(async () => native().onTableActivate({ nativeEvent: { ids: ["removed"] } }));
  expect(onActivate.mock.calls).toEqual([[{ ids: ["r1"] }]]);
  await act(async () => native().onTableContextMenu({ nativeEvent: { ids: ["r0", "r2"], rowId: "r2", x: 40, y: 120.5 } }));
  await act(async () => native().onTableContextMenu({ nativeEvent: { ids: [], rowId: "", x: 10, y: 300 } }));
  expect(onContextMenu.mock.calls).toEqual([[{ rowId: "r2", ids: ["r0", "r2"], position: { x: 40, y: 120.5 } }], [{ rowId: null, ids: [], position: { x: 10, y: 300 } }]]);
});

test("an outline sends flattened rows and controlled expansion, and reports proposed expansion", async () => {
  const onExpandedChange = vi.fn();
  await mount(React.createElement(Outline, outlineProps({ onExpandedChange, selectedIds: ["a1x"] })));
  expect(native()).toMatchObject({ outline: true, expandedIds: ["a"], selectedIds: ["a1x"], sortJson: "[]" });
  await act(async () => native().onTableExpandedChange({ nativeEvent: { ids: ["a", "a1", "c"], eventCount: 1 } }));
  expect(onExpandedChange).toHaveBeenCalledWith(["a", "a1"]);
  expect(native()).toMatchObject({ expandedIds: ["a"], eventCount: 1 });
});

test("unmounted tables ignore late native events", async () => {
  const onSelectionChange = vi.fn();
  await mount(React.createElement(Table, tableProps({ onSelectionChange })));
  const { onTableSelectionChange } = native();
  await act(async () => { rendered.unmount(); rendered = undefined; });
  onTableSelectionChange({ nativeEvent: { ids: ["r0"], eventCount: 1 } });
  expect(onSelectionChange).not.toHaveBeenCalled();
});

test("application callback errors propagate instead of being reported as native data errors", async () => {
  const onError = vi.fn(), failure = new Error("application failure");
  await mount(React.createElement(Table, tableProps({ onError, onSelectionChange: () => { throw failure; } })));
  expect(() => native().onTableSelectionChange({ nativeEvent: { ids: ["r1"], eventCount: 1 } })).toThrow(failure);
  expect(onError).not.toHaveBeenCalled();
});
