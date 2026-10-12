import { useMemo, useState } from "react";
import type {
  OutlineProps, OutlineRow, TableActivateEvent, TableColumn, TableColumnLayout, TableContextMenuEvent, TableProps, TableRow, TableSortDescriptor,
} from "@legendapp/spark/ui/table";
import { useI18n } from "../../shell/app-controller";
import { TABLE_MESSAGES, useTableMessages, type TableKind } from "./table-messages";

// Data and controlled state for the Table and Outline screens. Rows are built once per
// locale and sorted by precomputed keys; sorting reorders the same row objects, so the
// table serializes no row again.
type Messages = (typeof TABLE_MESSAGES)["en"];
type Format = (value: number) => string;
export const TABLE_ROW_COUNT = 10_000;
export const OUTLINE_SHAPE = { groups: 10, folders: 10, files: 99 } as const;
const FILE_KINDS: readonly TableKind[] = ["document", "image", "audio", "archive"];
const sizeOf = (index: number) => (index * 7919) % 9973 + 1;
type Entry = { row: TableRow; keys: Record<"name" | "size", number> };

export function tableColumns(t: Messages): TableColumn[] {
  return [
    { id: "name", title: t.columns.name, width: 220, minWidth: 120, maxWidth: 480, sortable: true },
    { id: "kind", title: t.columns.kind, width: 120, minWidth: 80, maxWidth: 240 },
    { id: "size", title: t.columns.size, width: 130, minWidth: 80, maxWidth: 240, sortable: true, alignment: "trailing" },
  ];
}
export function tableEntries(t: Messages, format: Format): Entry[] {
  return Array.from({ length: TABLE_ROW_COUNT }, (_, index) => {
    const number = index + 1, size = sizeOf(number);
    return { keys: { name: number, size }, row: { id: `file-${number}`, cells: { name: t.file(format(number)), kind: t.kinds[FILE_KINDS[number % FILE_KINDS.length]!], size: t.kilobytes(format(size)) } } };
  });
}
/** Applies every descriptor in order; the row number breaks remaining ties. */
export function sortEntries(entries: readonly Entry[], sort: readonly TableSortDescriptor[]): TableRow[] {
  const descriptors = sort.filter((descriptor): descriptor is TableSortDescriptor & { columnId: "name" | "size" } => descriptor.columnId === "name" || descriptor.columnId === "size");
  return [...entries].sort((a, b) => {
    for (const { columnId, direction } of descriptors) {
      const difference = a.keys[columnId] - b.keys[columnId];
      if (difference) return direction === "ascending" ? difference : -difference;
    }
    return a.keys.name - b.keys.name;
  }).map(entry => entry.row);
}
export function outlineRows(t: Messages, format: Format): OutlineRow[] {
  const { groups, folders, files } = OUTLINE_SHAPE;
  return Array.from({ length: groups }, (_, g) => ({
    id: `group-${g + 1}`, cells: { name: t.group(format(g + 1)), kind: t.kinds.group, size: t.items(format(folders)) },
    children: Array.from({ length: folders }, (_, f) => ({
      id: `folder-${g + 1}-${f + 1}`, cells: { name: t.folder(`${format(g + 1)}.${format(f + 1)}`), kind: t.kinds.folder, size: t.items(format(files)) },
      children: Array.from({ length: files }, (_, i) => {
        const number = (g * folders + f) * files + i + 1;
        return { id: `item-${g + 1}-${f + 1}-${i + 1}`, cells: { name: t.file(format(i + 1)), kind: t.kinds[FILE_KINDS[number % FILE_KINDS.length]!], size: t.kilobytes(format(sizeOf(number))) } };
      }),
    })),
  }));
}

/** A readout that stays short when Command-A selects every row. */
export const describeIds = (ids: readonly string[]) => JSON.stringify({ count: ids.length, first: ids.slice(0, 3) });
function useLastEvent() {
  const [event, setEvent] = useState("null");
  return {
    event,
    onActivate: ({ ids }: TableActivateEvent) => setEvent(JSON.stringify({ activate: JSON.parse(describeIds(ids)) })),
    onContextMenu: ({ rowId, ids, position }: TableContextMenuEvent) => setEvent(JSON.stringify({ contextMenu: { rowId, ...JSON.parse(describeIds(ids)), position: { x: Math.round(position.x), y: Math.round(position.y) } } })),
  };
}

export function useTableDemo() {
  const { locale, t: shell } = useI18n();
  const t = useTableMessages();
  const columns = useMemo(() => tableColumns(t), [t]);
  const entries = useMemo(() => tableEntries(TABLE_MESSAGES[locale], shell.number), [locale, shell]);
  const [sort, setSort] = useState<TableSortDescriptor[]>([{ columnId: "name", direction: "ascending" }]);
  const rows = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const [selectedIds, setSelectedIds] = useState<string[]>(["file-2"]);
  // Controlled layout: an app would persist this (for example with @legendapp/spark/settings).
  const [columnLayout, setColumnLayout] = useState<TableColumnLayout[]>(() => columns.map(({ id, width }) => ({ id, width: width! })));
  const last = useLastEvent();
  const props = {
    columns, rows, selectionMode: "multiple", selectedIds, onSelectionChange: setSelectedIds, sort, onSortChange: setSort,
    columnLayout, onColumnLayoutChange: setColumnLayout, onActivate: last.onActivate, onContextMenu: last.onContextMenu,
  } satisfies TableProps;
  return { props, event: last.event };
}

export function useOutlineDemo() {
  const { locale, t: shell } = useI18n();
  const t = useTableMessages();
  const columns = useMemo(() => tableColumns(t).map(({ sortable, ...column }) => column), [t]);
  const rows = useMemo(() => outlineRows(TABLE_MESSAGES[locale], shell.number), [locale, shell]);
  const [expandedIds, setExpandedIds] = useState<string[]>(["group-1", "folder-1-1"]);
  const [selectedIds, setSelectedIds] = useState<string[]>(["item-1-1-2"]);
  const [columnLayout, setColumnLayout] = useState("null");
  const last = useLastEvent();
  const props = {
    columns, rows, selectionMode: "multiple", selectedIds, onSelectionChange: setSelectedIds, expandedIds, onExpandedChange: setExpandedIds,
    onColumnLayoutChange: layout => setColumnLayout(JSON.stringify(layout)), onActivate: last.onActivate, onContextMenu: last.onContextMenu,
  } satisfies OutlineProps;
  return { props, columnLayout, event: last.event };
}
