import { useMemo, useState } from "react";
import { Text, View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeTable from "./TableNativeComponent";
export interface TableColumn {
  id: string;
  /** Header title. */
  title: string;
  /** Initial width; the user can resize columns, and the last column takes the remaining width. */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Text alignment of the header and cells: `leading` (default), `center` or `trailing`. */
  alignment?: "leading" | "center" | "trailing";
  /** Tabular digits, for numbers, dates and hashes. */
  monospacedDigits?: boolean;
  /** The system's secondary text color, for supporting columns such as an author or date. */
  secondary?: boolean;
}
export interface TableRow {
  id: string;
  /** Cell text by column ID; a missing value is an empty cell. */
  values: Readonly<Record<string, string>>;
}
export interface TableSelectionEvent { id: string | null; ids: string[] }
export interface TableBaseProps extends Omit<SpecializedViewProps, "children"> {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  /** Hides the column header. Defaults to true (shown). */
  headerVisible?: boolean;
  /** Alternating row backgrounds instead of vertical grid lines. */
  alternatingRows?: boolean;
  /** Row height in points; defaults to the system's row size. */
  rowHeight?: number;
  onSelectionChange: (event: TableSelectionEvent) => void;
  onDoubleClick?: (event: { id: string }) => void;
  children?: never;
}
/** `selectedId` selects one row; `selectedIds` enables multiple selection (⌘/⇧-click). */
export type TableSelectionProps = { selectedId: string | null; selectedIds?: never } | { selectedIds: readonly string[]; selectedId?: never };
export type TableProps = TableBaseProps & TableSelectionProps;
export function getTableAvailability() { return macosViewAvailability("SparkTable"); }
const columnKeys = ["id", "title", "width", "minWidth", "maxWidth", "alignment", "monospacedDigits", "secondary"];
function validate(columns: readonly TableColumn[], rows: readonly TableRow[]) {
  if (!Array.isArray(columns) || !columns.length) throw new SparkError("E_INVALID_ARGUMENT", "A table needs at least one column");
  const columnIds = new Set<string>();
  for (const column of columns) {
    if (!column || typeof column !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected a table column");
    for (const key of Object.keys(column)) if (!columnKeys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown table column option: ${key}`);
    identifier(column.id, "column ID");
    if (columnIds.has(column.id)) throw new SparkError("E_INVALID_ARGUMENT", "Table column IDs must be unique"); columnIds.add(column.id);
    if (typeof column.title !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected a column title");
    for (const key of ["width", "minWidth", "maxWidth"] as const) if (column[key] !== undefined) finite(column[key], `column ${key}`, 1, 20000);
    if ((column.minWidth ?? 0) > (column.maxWidth ?? Infinity) || (column.width !== undefined && (column.width < (column.minWidth ?? 0) || column.width > (column.maxWidth ?? Infinity)))) throw new SparkError("E_INVALID_ARGUMENT", "Column width is outside its limits");
    if (column.alignment !== undefined && !["leading", "center", "trailing"].includes(column.alignment)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid column alignment");
    for (const key of ["monospacedDigits", "secondary"] as const) if (column[key] !== undefined && typeof column[key] !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `Column ${key} must be boolean`);
  }
  if (!Array.isArray(rows)) throw new SparkError("E_INVALID_ARGUMENT", "Expected table rows");
  const rowIds = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !row.values || typeof row.values !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected table rows with values");
    identifier(row.id, "row ID");
    if (rowIds.has(row.id)) throw new SparkError("E_INVALID_ARGUMENT", "Table row IDs must be unique"); rowIds.add(row.id);
    for (const [key, value] of Object.entries(row.values)) {
      if (!columnIds.has(key)) throw new SparkError("E_INVALID_ARGUMENT", `Row value for unknown column: ${key}`);
      if (typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Table cell values must be strings");
    }
  }
}
/** AppKit's NSTableView with a header and text columns. Only visible rows have cells, so long tables stay cheap. */
export function Table(props: TableProps) {
  const { columns, rows, selectedId, selectedIds, headerVisible = true, alternatingRows = false, rowHeight, onSelectionChange, onDoubleClick, ref, onError, style, ...rest } = props;
  validate(columns, rows);
  if (typeof headerVisible !== "boolean" || typeof alternatingRows !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "headerVisible and alternatingRows must be boolean");
  if (rowHeight !== undefined) finite(rowHeight, "row height", 1, 1000);
  if (typeof onSelectionChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onSelectionChange");
  callback(onDoubleClick, "double-click");
  const multiple = selectedIds !== undefined;
  if (multiple === (selectedId !== undefined)) throw new SparkError("E_INVALID_ARGUMENT", "Pass exactly one of selectedId and selectedIds");
  const selection = multiple ? selectedIds : selectedId === null ? [] : [selectedId];
  if (!Array.isArray(selection) || selection.some(id => typeof id !== "string")) throw new SparkError("E_INVALID_ARGUMENT", "Selected IDs must be strings");
  const control = useControl({ ref, onError }, getTableAvailability());
  const [revision, revise] = useState(0);
  const columnsJson = useMemo(() => JSON.stringify(columns), [columns]);
  const rowsJson = useMemo(() => JSON.stringify(rows), [rows]);
  function selectionChanged(event: NativeSyntheticEvent<{ id: string; idsJson: string }>) {
    if (!control.active()) return;
    let ids: string[];
    try { ids = JSON.parse(event.nativeEvent.idsJson); if (!Array.isArray(ids) || ids.some(id => !rows.some(row => row.id === id))) throw new Error("Unknown row"); }
    catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid table selection", { cause })); return; }
    revise(value => value + 1);
    onSelectionChange({ id: event.nativeEvent.id || (ids[0] ?? null), ids });
  }
  if (control.failed) return <View {...rest} ref={control.ref} style={style} accessibilityRole="list">
    {rows.map(row => <Text key={row.id} accessibilityState={{ selected: selection.includes(row.id) }}>{columns.map(column => row.values[column.id] ?? "").join("  ")}</Text>)}
  </View>;
  return <NativeTable {...rest} ref={control.ref} style={style} columnsJson={columnsJson} rowsJson={rowsJson} selectedIdsJson={JSON.stringify(selection)} selectionRevision={revision}
    allowsMultipleSelection={multiple} headerVisible={headerVisible} alternatingRows={alternatingRows} rowHeight={rowHeight ?? 0}
    onTableSelectionChange={selectionChanged} onTableDoubleClick={event => { if (control.active() && rows.some(row => row.id === event.nativeEvent.id)) onDoubleClick?.({ id: event.nativeEvent.id }); }} />;
}
