import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";

/** Leading and trailing follow the layout direction: leading is the right edge in right-to-left layouts. */
export type TableColumnAlignment = "leading" | "center" | "trailing";
export interface TableColumn {
  id: string;
  title: string;
  /** Initial width in points (default 120). Later changes apply; a user resize is kept until the width prop changes. */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Default true. */
  resizable?: boolean;
  /** Default false. A sortable column requires the `sort` and `onSortChange` props. */
  sortable?: boolean;
  alignment?: TableColumnAlignment;
}
/** Rows are immutable: replace a row object to change it. Only replaced rows are serialized again. */
export interface TableRow { id: string; cells: Readonly<Record<string, string>> }
/** `children` makes a row expandable, even when it is empty. */
export interface OutlineRow extends TableRow { children?: readonly OutlineRow[] }
export type TableSortDirection = "ascending" | "descending";
/** The first descriptor is the primary key; AppKit keeps earlier keys as tie-breakers. */
export interface TableSortDescriptor { columnId: string; direction: TableSortDirection }
/** One entry per column, in display order. */
export interface TableColumnLayout { id: string; width: number }
export type TableSelectionMode = "none" | "single" | "multiple";

/** Rows per JSON chunk. Native re-parses only chunks whose text changed. */
export const ROW_CHUNK_SIZE = 256;
const DEFAULT_WIDTH = 120, DEFAULT_MIN_WIDTH = 24, DEFAULT_MAX_WIDTH = 100000;
const COLUMN_KEYS = new Set(["id", "title", "width", "minWidth", "maxWidth", "resizable", "sortable", "alignment"]);
const TABLE_ROW_KEYS = new Set(["id", "cells"]), OUTLINE_ROW_KEYS = new Set(["id", "cells", "children"]);
const ALIGNMENTS: readonly TableColumnAlignment[] = ["leading", "center", "trailing"];

function invalid(message: string, cause?: unknown): never { throw new SparkError("E_INVALID_ARGUMENT", message, cause === undefined ? undefined : { cause }); }
function invalidData(message: string): never { throw new SparkError("E_INVALID_DATA", message); }
/** Native passes IDs as UTF-8, so they must be well-formed: encodeURIComponent rejects lone surrogates. */
function id(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.length || value.includes("\0")) invalid(`Expected a nonempty ${name}`);
  try { encodeURIComponent(value); } catch { invalid(`Expected a well-formed ${name}`); }
}
function knownKeys(value: object, keys: Set<string>, name: string) {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${name} option: ${key}`);
}
function width(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalid(`Invalid ${name}`);
  return value;
}

export interface EncodedColumns { json: string; ids: ReadonlySet<string>; sortable: ReadonlySet<string>; limits: ReadonlyMap<string, readonly [min: number, max: number]> }
export function encodeColumns(columns: readonly TableColumn[]): EncodedColumns {
  if (!Array.isArray(columns) || !columns.length) invalid("A table requires at least one column");
  const ids = new Set<string>(), sortable = new Set<string>(), limits = new Map<string, readonly [number, number]>();
  const encoded = columns.map(column => {
    if (!column || typeof column !== "object") invalid("Invalid table column");
    knownKeys(column, COLUMN_KEYS, "table column");
    id(column.id, "column ID");
    if (ids.has(column.id)) invalid("Table column IDs must be unique");
    ids.add(column.id);
    if (typeof column.title !== "string") invalid("Expected a column title");
    const min = column.minWidth === undefined ? DEFAULT_MIN_WIDTH : width(column.minWidth, "column minWidth");
    const max = column.maxWidth === undefined ? DEFAULT_MAX_WIDTH : width(column.maxWidth, "column maxWidth");
    const initial = column.width === undefined ? Math.min(max, Math.max(min, DEFAULT_WIDTH)) : width(column.width, "column width");
    if (min > max || initial < min || initial > max) invalid("Column widths require minWidth <= width <= maxWidth");
    for (const key of ["resizable", "sortable"] as const) if (column[key] !== undefined && typeof column[key] !== "boolean") invalid(`Expected column ${key} boolean`);
    if (column.alignment !== undefined && !ALIGNMENTS.includes(column.alignment)) invalid("Invalid column alignment");
    if (column.sortable) sortable.add(column.id);
    limits.set(column.id, [min, max]);
    return { id: column.id, title: column.title, width: initial, minWidth: min, maxWidth: max, resizable: column.resizable ?? true, sortable: column.sortable ?? false, alignment: column.alignment ?? "leading" };
  });
  return { json: JSON.stringify(encoded), ids, sortable, limits };
}

// Validated row JSON, keyed by row identity. A row is serialized once, however many renders and sorts it survives.
const tableRowJson = new WeakMap<object, string>(), outlineRowJson = new WeakMap<object, string>();
function encodeRow(row: TableRow, outline: boolean): string {
  if (!row || typeof row !== "object") invalid("Invalid table row");
  const cache = outline ? outlineRowJson : tableRowJson;
  const cached = cache.get(row);
  if (cached !== undefined) return cached;
  knownKeys(row, outline ? OUTLINE_ROW_KEYS : TABLE_ROW_KEYS, outline ? "outline row" : "table row");
  id(row.id, "row ID");
  const cells = row.cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) invalid("Row cells must be an object of column IDs to text");
  for (const key in cells) if (Object.hasOwn(cells, key) && typeof cells[key] !== "string") invalid("Row cell text must be a string");
  const json = JSON.stringify({ id: row.id, cells });
  cache.set(row, json);
  return json;
}

export interface EncodedRows {
  /** JSON arrays of `[depth, expandable, {id, cells}]` in display (pre-)order. */
  chunks: readonly string[];
  ids: ReadonlySet<string>;
  /** Outline rows with `children`. */
  expandable: ReadonlySet<string>;
}
export function encodeRows(rows: readonly (TableRow | OutlineRow)[], outline: boolean): EncodedRows {
  if (!Array.isArray(rows)) invalid("Rows must be an array");
  const ids = new Set<string>(), expandable = new Set<string>(), chunks: string[] = [];
  let chunk: string[] = [];
  const visit = (row: OutlineRow, depth: number) => {
    const json = encodeRow(row, outline);
    if (ids.has(row.id)) invalid(`Row IDs must be unique: ${row.id}`);
    ids.add(row.id);
    const children = outline ? row.children : undefined;
    if (children !== undefined && !Array.isArray(children)) invalid("Outline row children must be an array");
    if (children) expandable.add(row.id);
    chunk.push(`[${depth},${children ? 1 : 0},${json}]`);
    if (chunk.length === ROW_CHUNK_SIZE) { chunks.push(`[${chunk.join(",")}]`); chunk = []; }
    if (children) for (const child of children) visit(child, depth + 1);
  };
  for (const row of rows) visit(row, 0);
  if (chunk.length) chunks.push(`[${chunk.join(",")}]`);
  return { chunks, ids, expandable };
}

function idList(value: unknown, name: string, known: ReadonlySet<string>): readonly string[] {
  if (!Array.isArray(value)) invalid(`${name} must be an array of row IDs`);
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !known.has(item)) invalid(`${name} must identify rows: ${String(item)}`);
    if (seen.has(item)) invalid(`${name} must not repeat a row ID`);
    seen.add(item);
  }
  return value;
}
export function encodeSelection(mode: TableSelectionMode, selectedIds: readonly string[], rows: EncodedRows): readonly string[] {
  if (!["none", "single", "multiple"].includes(mode)) invalid("Invalid selection mode");
  idList(selectedIds, "selectedIds", rows.ids);
  if (mode === "none" ? selectedIds.length > 0 : mode === "single" && selectedIds.length > 1) invalid(`Selection mode ${mode} allows ${mode === "none" ? "no" : "one"} selected row`);
  return selectedIds;
}
export function encodeExpanded(expandedIds: readonly string[], rows: EncodedRows): readonly string[] {
  return idList(expandedIds, "expandedIds", rows.expandable);
}

export function encodeSort(sort: readonly TableSortDescriptor[], columns: EncodedColumns): string {
  if (!Array.isArray(sort)) invalid("Sort must be an array of sort descriptors");
  const seen = new Set<string>();
  return JSON.stringify(sort.map(descriptor => {
    if (!descriptor || typeof descriptor !== "object") invalid("Invalid sort descriptor");
    knownKeys(descriptor, new Set(["columnId", "direction"]), "sort descriptor");
    if (!columns.sortable.has(descriptor.columnId)) invalid(`Sort column must be a sortable column: ${String(descriptor.columnId)}`);
    if (seen.has(descriptor.columnId)) invalid("Sort descriptors must not repeat a column");
    seen.add(descriptor.columnId);
    if (descriptor.direction !== "ascending" && descriptor.direction !== "descending") invalid("Sort direction is ascending or descending");
    return { columnId: descriptor.columnId, ascending: descriptor.direction === "ascending" };
  }));
}
/** Native sort descriptors are AppKit's, newest first; only sortable columns can appear. */
export function decodeSort(json: unknown, columns: EncodedColumns): TableSortDescriptor[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json as string); } catch { invalidData("Invalid native sort descriptors"); }
  if (typeof json !== "string" || !Array.isArray(parsed)) invalidData("Invalid native sort descriptors");
  return parsed.map(item => {
    if (!item || typeof item.columnId !== "string" || !columns.sortable.has(item.columnId) || typeof item.ascending !== "boolean") invalidData("Invalid native sort descriptor");
    return { columnId: item.columnId, direction: item.ascending ? "ascending" : "descending" };
  });
}

/** Returns "" when the native view owns the layout. Columns without an entry follow, at their own widths. */
export function encodeLayout(layout: readonly TableColumnLayout[] | undefined, columns: EncodedColumns): string {
  if (layout === undefined) return "";
  if (!Array.isArray(layout)) invalid("Column layout must be an array");
  const seen = new Set<string>();
  return JSON.stringify(layout.map(entry => {
    if (!entry || typeof entry !== "object") invalid("Invalid column layout entry");
    knownKeys(entry, new Set(["id", "width"]), "column layout");
    const limits = columns.limits.get(entry.id);
    if (!limits) invalid(`Column layout must identify columns: ${String(entry.id)}`);
    if (seen.has(entry.id)) invalid("Column layout must not repeat a column");
    seen.add(entry.id);
    if (width(entry.width, "column layout width") < limits[0] || entry.width > limits[1]) invalid("Column layout width must be within the column's minWidth and maxWidth");
    return { id: entry.id, width: entry.width };
  }));
}
export function decodeLayout(json: unknown, columns: EncodedColumns): TableColumnLayout[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json as string); } catch { invalidData("Invalid native column layout"); }
  if (typeof json !== "string" || !Array.isArray(parsed) || parsed.length !== columns.ids.size) invalidData("Invalid native column layout");
  const seen = new Set<string>();
  return parsed.map(item => {
    if (!item || typeof item.id !== "string" || !columns.ids.has(item.id) || seen.has(item.id) || typeof item.width !== "number" || !Number.isFinite(item.width) || item.width <= 0) invalidData("Invalid native column layout entry");
    seen.add(item.id);
    return { id: item.id, width: item.width };
  });
}

/**
 * Row IDs from a native event. Native may still hold rows that JavaScript has since
 * replaced, so IDs that are no longer rows are dropped rather than reported.
 */
export function decodeIds(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) invalidData("Invalid native row IDs");
  return (value as string[]).filter(item => known.has(item));
}
