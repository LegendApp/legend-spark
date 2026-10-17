import { useMemo } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { isEventCount, useControl, useEventAcknowledgment } from "../control";
import { callback, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeTable from "./TableNativeComponent";
import {
  decodeIds, decodeLayout, decodeSort, encodeColumns, encodeExpanded, encodeLayout, encodeRows, encodeSelection, encodeSort,
  type OutlineRow, type TableColumnLayout, type TableRow, type TableSelectionMode, type TableSortDescriptor,
} from "./model";
export type { OutlineRow, TableColumn, TableColumnAlignment, TableColumnLayout, TableRow, TableSelectionMode, TableSortDescriptor, TableSortDirection } from "./model";

/** Rows activated by a double-click or Return: the selection, or the clicked row when it is outside the selection. */
export interface TableActivateEvent { ids: string[] }
/** Reported by `onContextMenu` on a right-click in the table. */
export interface TableContextMenuEvent {
  /** The row under the pointer, or null below the last row. */
  rowId: string | null;
  /** The rows the menu acts on: the selection when `rowId` is selected, otherwise just `rowId`. */
  ids: string[];
  /** Logical points from the owning window content's top-left, as `showContextMenu` takes them. */
  position: { x: number; y: number };
}
/**
 * Selection props of `Table` and `Outline`. `selectionMode` defaults to `single`; unless it is `none`, selection is controlled
 * and requires `selectedIds` and `onSelectionChange`.
 */
export type TableSelectionProps =
  | { selectionMode: "none"; selectedIds?: never; onSelectionChange?: never }
  | { selectionMode?: Exclude<TableSelectionMode, "none">; selectedIds: readonly string[]; onSelectionChange: (ids: string[]) => void };
/** Required together when any column is sortable. Rows are sorted by the application, not by the view. */
export type TableSortProps =
  | { sort?: never; onSortChange?: never }
  | { sort: readonly TableSortDescriptor[]; onSortChange: (sort: TableSortDescriptor[]) => void };
/**
 * Without `columnLayout` the view owns column widths and order and reports user changes.
 * With it, the layout is controlled: persist what `onColumnLayoutChange` reports and pass it back.
 */
export type TableColumnLayoutProps =
  | { columnLayout?: never; onColumnLayoutChange?: (layout: TableColumnLayout[]) => void }
  | { columnLayout: readonly TableColumnLayout[]; onColumnLayoutChange: (layout: TableColumnLayout[]) => void };
/** Props shared by `Table` and `Outline`, generic over the row type. */
export type TableBaseProps<Row> = Omit<SpecializedViewProps, "children"> & TableSelectionProps & TableSortProps & TableColumnLayoutProps & {
  columns: readonly import("./model").TableColumn[];
  rows: readonly Row[];
  /** Default true: users drag column headers to reorder them. */
  columnReordering?: boolean;
  onActivate?: (event: TableActivateEvent) => void;
  onContextMenu?: (event: TableContextMenuEvent) => void;
};
/** Props for `Table`. Expansion props throw E_UNSUPPORTED_OPTION; they belong to `Outline`. */
export type TableProps = TableBaseProps<TableRow>;
/** Expansion is controlled: `onExpandedChange` proposes the expanded row IDs, in display order. */
export type OutlineProps = TableBaseProps<OutlineRow> & { expandedIds: readonly string[]; onExpandedChange: (ids: string[]) => void };

/** NSTableView and NSOutlineView on macOS 14 and later; Windows, iOS, Android and web are unsupported. */
export function getTableAvailability(): Availability { return macosViewAvailability("SparkTable"); }

const NONE: readonly string[] = [];
type Counted = { eventCount: number };
function NativeTableView({ outline, props }: { outline: boolean; props: TableProps | OutlineProps }) {
  const availability = getTableAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${outline ? "Outline" : "Table"} is unavailable: ${availability.reason}`);
  const {
    columns, rows, selectionMode = "single", selectedIds = NONE, onSelectionChange, sort, onSortChange, columnLayout, onColumnLayoutChange,
    columnReordering = true, onActivate, onContextMenu, expandedIds = NONE, onExpandedChange, ref, onError, ...view
  } = props as TableProps & Partial<Pick<OutlineProps, "expandedIds" | "onExpandedChange">>;
  if (!outline && ("expandedIds" in props || "onExpandedChange" in props)) throw new SparkError("E_UNSUPPORTED_OPTION", "Expansion is an Outline option");
  const encodedColumns = useMemo(() => encodeColumns(columns), [columns]);
  const encodedRows = useMemo(() => encodeRows(rows, outline), [rows, outline]);
  const selected = useMemo(() => encodeSelection(selectionMode, selectedIds, encodedRows), [selectionMode, selectedIds, encodedRows]);
  const expanded = useMemo(() => outline ? encodeExpanded(expandedIds, encodedRows) : NONE, [outline, expandedIds, encodedRows]);
  const sortJson = useMemo(() => sort === undefined ? "[]" : encodeSort(sort, encodedColumns), [sort, encodedColumns]);
  const layoutJson = useMemo(() => encodeLayout(columnLayout, encodedColumns), [columnLayout, encodedColumns]);
  if (selectionMode !== "none" && typeof onSelectionChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Selection is controlled and requires onSelectionChange");
  if ((sort === undefined) !== (onSortChange === undefined) || (onSortChange !== undefined && typeof onSortChange !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "sort and onSortChange are required together");
  if (encodedColumns.sortable.size && sort === undefined) throw new SparkError("E_INVALID_ARGUMENT", "Sortable columns require sort and onSortChange");
  if (columnLayout !== undefined && typeof onColumnLayoutChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "A controlled columnLayout requires onColumnLayoutChange");
  if (outline && typeof onExpandedChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Outline expansion is controlled and requires onExpandedChange");
  if (typeof columnReordering !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected columnReordering boolean");
  for (const [handler, name] of [[onColumnLayoutChange, "column layout"], [onActivate, "activate"], [onContextMenu, "context menu"]] as const) callback(handler, name);
  const control = useControl({ ref, onError });
  const events = useEventAcknowledgment();
  /** Malformed native data goes to onError; application callbacks run outside, so their errors propagate. */
  function decode<V>(read: () => V): { value: V } | undefined {
    try { return { value: read() }; }
    catch (error) { if (error instanceof SparkError && error.code === "E_INVALID_DATA") { control.error(error); return undefined; } throw error; }
  }
  // Echo every counted event, even a rejected one: native restores controlled state only once caught up.
  function counted<T extends Counted, V>(event: NativeSyntheticEvent<T>, read: (data: T) => V, deliver: ((value: V) => void) | undefined) {
    const data = event?.nativeEvent;
    if (!isEventCount(data?.eventCount)) { control.error(new SparkError("E_INVALID_DATA", "Invalid native table event")); return; }
    if (!events.acknowledge(data.eventCount) || !control.active()) return;
    const result = decode(() => read(data));
    if (result) deliver?.(result.value);
  }
  function contextMenu(data: { ids: unknown; rowId: unknown; x: unknown; y: unknown }): TableContextMenuEvent {
    if (typeof data?.rowId !== "string" || !Number.isFinite(data.x) || !Number.isFinite(data.y)) throw new SparkError("E_INVALID_DATA", "Invalid native context menu event");
    return { rowId: encodedRows.ids.has(data.rowId) ? data.rowId : null, ids: decodeIds(data.ids, encodedRows.ids), position: { x: data.x as number, y: data.y as number } };
  }
  return <NativeTable {...view} ref={control.ref} outline={outline} columnsJson={encodedColumns.json} rowChunks={encodedRows.chunks} selectionMode={selectionMode}
    selectedIds={selected} expandedIds={expanded} sortJson={sortJson} columnLayoutJson={layoutJson} columnReordering={columnReordering} eventCount={events.eventCount}
    onTableSelectionChange={event => counted(event, data => decodeIds(data.ids, encodedRows.ids), onSelectionChange)}
    onTableExpandedChange={event => counted(event, data => decodeIds(data.ids, encodedRows.expandable), onExpandedChange)}
    onTableSortChange={event => counted(event, data => decodeSort(data.sortJson, encodedColumns), onSortChange)}
    onTableColumnLayoutChange={event => counted(event, data => decodeLayout(data.layoutJson, encodedColumns), onColumnLayoutChange)}
    onTableActivate={event => {
      const ids = control.active() ? decode(() => decodeIds(event?.nativeEvent?.ids, encodedRows.ids))?.value : undefined;
      if (ids?.length) onActivate?.({ ids });
    }}
    onTableContextMenu={event => {
      const menu = control.active() ? decode(() => contextMenu(event?.nativeEvent))?.value : undefined;
      if (menu) onContextMenu?.(menu);
    }}
    onTableError={event => control.error(new SparkError("E_INVALID_DATA", typeof event?.nativeEvent?.message === "string" ? event.nativeEvent.message : "Invalid native table error"))} />;
}

/** A native NSTableView of text cells. Rows are virtualized by AppKit's view reuse. */
export function Table(props: TableProps) { return <NativeTableView outline={false} props={props} />; }
/** A native NSOutlineView: the first column shows the disclosure triangles. */
export function Outline(props: OutlineProps) { return <NativeTableView outline props={props} />; }
