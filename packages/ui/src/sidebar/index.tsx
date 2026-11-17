import { Children, Fragment, createContext, isValidElement, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSidebar from "./SidebarNativeComponent";
import NativeSidebarItem from "./SidebarItemNativeComponent";
export interface SidebarItemData {
  id: string;
  label: string;
  selectable?: boolean;
  /** A section header: the source list's group-row style, never selectable. */
  group?: boolean;
  /** A trailing count in the system's secondary style. */
  count?: number;
  /** Nested rows, shown under a disclosure (Show/Hide on group rows). */
  children?: readonly SidebarItemData[];
}
export type SidebarRowHeight = number | "auto";
export interface SidebarSelectionEvent { id: string | null; ids: string[] }
export interface SidebarExpandedChangeEvent { id: string; expanded: boolean }
export interface SidebarDoubleClickEvent { id: string }
export interface SidebarContentLayoutEvent { width: number; height: number }
export interface SidebarContextMenuEvent {
  id: string;
  /** Logical top-left coordinates within the row and the owning window's content. */
  position: { x: number; y: number };
  windowPosition: { x: number; y: number };
  modifiers: { alt: boolean; control: boolean; meta: boolean; shift: boolean };
}
export type SidebarListStyle = "sidebar" | "plain";
export interface SidebarBaseProps extends Omit<SpecializedViewProps, "children"> {
  contentInsetTop?: number;
  /** `sidebar` (default) is the source list for window sidebars; `plain` is a content list with standard selection. */
  listStyle?: SidebarListStyle;
  defaultRowHeight?: number;
  /** IDs of collapsed rows. Applied when the value changes; the user's toggles report through `onExpandedChange`. */
  collapsedIds?: readonly string[];
  onExpandedChange?: (event: SidebarExpandedChangeEvent) => void;
  onDoubleClick?: (event: SidebarDoubleClickEvent) => void;
  onContentLayout?: (event: SidebarContentLayoutEvent) => void;
  onSelectionChange: (event: SidebarSelectionEvent) => void;
}
/** `selectedId` selects one row; `selectedIds` enables multiple selection (⌘/⇧-click). */
export type SidebarSelectionProps = { selectedId: string | null; selectedIds?: never } | { selectedIds: readonly string[]; selectedId?: never };
export type SidebarProps = SidebarBaseProps & SidebarSelectionProps & ({ items: readonly SidebarItemData[]; children?: never } | { items?: never; children: ReactNode });
export interface SidebarItemProps extends SpecializedViewProps {
  id: string;
  /** Nests this row under an earlier row. */
  parentId?: string;
  /** A section header: the source list's group-row style, never selectable. */
  group?: boolean;
  /** A trailing count in the system's secondary style, beside the row's content. */
  count?: number;
  rowHeight?: SidebarRowHeight;
  selectable?: boolean;
  onContextMenu?: (event: SidebarContextMenuEvent) => void;
}
interface SidebarEntry { id: string; label?: string; selectable?: boolean; group?: boolean; count?: number; parentId?: string }
function count(value: unknown) {
  if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar count must be a non-negative integer");
}
function flag(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} boolean`);
}
function flattenItems(items: readonly SidebarItemData[], parentId: string | undefined, entries: SidebarEntry[]) {
  if (!Array.isArray(items)) throw new SparkError("E_INVALID_ARGUMENT", "Expected sidebar items array");
  for (const item of items) {
    if (!item || typeof item !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Invalid sidebar item");
    entries.push({ id: item.id, label: item.label, selectable: item.selectable, group: item.group, count: item.count, parentId });
    if (item.children !== undefined) flattenItems(item.children, item.id, entries);
  }
  return entries;
}
function stringList(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} array`);
  for (const id of value) identifier(id, name);
  return value;
}
// Inside a Sidebar: the row width the native list reports, which React rows take, since it excludes
// the source-list insets and a scroller. Undefined until the first native layout.
const SidebarContext = createContext<{ rowWidth: number | undefined } | null>(null);
export function getSidebarAvailability() {
  const availability = macosViewAvailability("Sidebar");
  return availability.available ? macosViewAvailability("SidebarItem") : availability;
}
function childRows(children: ReactNode): ReactElement<SidebarItemProps>[] {
  const rows: ReactElement<SidebarItemProps>[] = [];
  Children.forEach(children, child => {
    if (child === null) return;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) { rows.push(...childRows(child.props.children)); return; }
    if (!isValidElement<SidebarItemProps>(child) || child.type !== SidebarItem) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar children must be SidebarItem elements or fragments");
    rows.push(child);
  });
  return rows;
}
export function Sidebar({ items, children, selectedId, selectedIds, collapsedIds, contentInsetTop = 0, defaultRowHeight = 28, listStyle = "sidebar", onContentLayout, onDoubleClick, onExpandedChange, onSelectionChange, ref, onError, ...props }: SidebarProps) {
  finite(contentInsetTop, "content inset"); finite(defaultRowHeight, "row height", 1);
  callback(onContentLayout, "content layout"); callback(onDoubleClick, "double click"); callback(onExpandedChange, "expanded change");
  if (listStyle !== "sidebar" && listStyle !== "plain") throw new SparkError("E_INVALID_ARGUMENT", "Invalid sidebar list style");
  if (typeof onSelectionChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Sidebar selection is controlled and requires onSelectionChange");
  if (items !== undefined && (children !== undefined || !Array.isArray(items))) throw new SparkError("E_INVALID_ARGUMENT", "Use either items or SidebarItem children");
  const multiple = selectedIds !== undefined;
  if (multiple === (selectedId !== undefined)) throw new SparkError("E_INVALID_ARGUMENT", "Use either selectedId or selectedIds");
  const { selectableIds, itemsJson } = useMemo(() => {
    const entries = items === undefined ? childRows(children).map(row => ({ ...row.props, label: undefined })) : flattenItems(items, undefined, []);
    const ids = new Set<string>(), selectableIds = new Set<string>();
    for (const item of entries) {
      identifier(item.id, "sidebar ID");
      if (ids.has(item.id)) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar IDs must be unique");
      if (item.parentId !== undefined && !ids.has(item.parentId)) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar parentId must identify an earlier row");
      ids.add(item.id);
      flag(item.selectable, "selectable"); flag(item.group, "group"); count(item.count);
      if (item.group && item.selectable) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar group rows are not selectable");
      if (items !== undefined) identifier(item.label, "sidebar label");
      if (item.selectable !== false && !item.group) selectableIds.add(item.id);
    }
    return { selectableIds, itemsJson: items === undefined ? "" : JSON.stringify(entries.map(({ id, label, group, selectable = !group, count, parentId }) =>
      ({ id, title: label, selectable, ...(group ? { group } : {}), ...(count !== undefined ? { count } : {}), ...(parentId !== undefined ? { parentId } : {}) }))) };
  }, [items, children]);
  const selected = multiple ? stringList(selectedIds, "selected sidebar ID") : selectedId === null ? [] : [selectedId];
  for (const id of selected) if (!selectableIds.has(id)) throw new SparkError("E_INVALID_ARGUMENT", "Selected sidebar ID must identify a selectable row");
  if (new Set(selected).size !== selected.length) throw new SparkError("E_INVALID_ARGUMENT", "Selected sidebar IDs must be unique");
  const selectedKey = selected.join("\n");
  const selectedIdsJson = useMemo(() => JSON.stringify(selected), [selectedKey]);
  const collapsedIdsJson = useMemo(() => collapsedIds === undefined ? "" : JSON.stringify(stringList(collapsedIds, "collapsed sidebar ID")), [collapsedIds]);
  const control = useControl({ ref, onError }, getSidebarAvailability());
  const [selectionRevision, revise] = useState(0);
  const [rowWidth, setRowWidth] = useState<number>();
  function selection(event: NativeSyntheticEvent<{ id: string; idsJson: string }>) {
    if (!control.active()) return;
    const id = event?.nativeEvent?.id;
    let ids: unknown;
    try { ids = JSON.parse(event?.nativeEvent?.idsJson); } catch { ids = undefined; }
    if (typeof id !== "string" || !Array.isArray(ids) || (id !== "" && !ids.includes(id)) || ids.some(value => typeof value !== "string" || !selectableIds.has(value)) || (!multiple && ids.length > 1)) {
      control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar selection")); return;
    }
    revise(value => value + 1); onSelectionChange?.({ id: id || null, ids: ids as string[] });
  }
  function expandedChange(event: NativeSyntheticEvent<{ id: string; expanded: boolean }>) {
    if (!control.active()) return;
    const data = event?.nativeEvent;
    if (typeof data?.id !== "string" || data.id === "" || typeof data.expanded !== "boolean") { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar expansion")); return; }
    onExpandedChange?.({ id: data.id, expanded: data.expanded });
  }
  function doubleClick(event: NativeSyntheticEvent<{ id: string }>) {
    if (!control.active()) return;
    const id = event?.nativeEvent?.id;
    if (typeof id !== "string" || id === "") { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar double click")); return; }
    onDoubleClick?.({ id });
  }
  function layout(event: NativeSyntheticEvent<{ width: number; height: number }>) {
    if (!control.active()) return;
    try { finite(event?.nativeEvent?.width, "content width"); finite(event?.nativeEvent?.height, "content height"); }
    catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar layout", { cause })); return; }
    onContentLayout?.({ width: event.nativeEvent.width, height: event.nativeEvent.height });
  }
  function rowLayout(event: NativeSyntheticEvent<{ width: number }>) {
    if (!control.active()) return;
    try { finite(event?.nativeEvent?.width, "row width"); }
    catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar row layout", { cause })); return; }
    setRowWidth(event.nativeEvent.width);
  }
  const context = useMemo(() => ({ rowWidth }), [rowWidth]);
  if (control.failed) return <View {...props} ref={control.ref}><SidebarContext.Provider value={context}>{items ? flattenItems(items, undefined, []).map(item => <Text key={item.id}>{item.label}</Text>) : children}</SidebarContext.Provider></View>;
  return <NativeSidebar {...props} ref={control.ref} itemsJson={itemsJson} listStyle={listStyle} allowsMultipleSelection={multiple} selectedIdsJson={selectedIdsJson} selectionRevision={selectionRevision} collapsedIdsJson={collapsedIdsJson} contentInsetTop={contentInsetTop} defaultRowHeight={defaultRowHeight} onSidebarLayout={layout} onSidebarRowLayout={rowLayout} onSidebarSelectionChange={selection} onSidebarExpandedChange={expandedChange} onSidebarDoubleClick={doubleClick}>
    <SidebarContext.Provider value={context}>{children}</SidebarContext.Provider>
  </NativeSidebar>;
}
export function SidebarItem({ id, children, parentId, group = false, count: rowCount, rowHeight, selectable = !group, onContextMenu, ref, onError, style, ...props }: SidebarItemProps) {
  const sidebar = useContext(SidebarContext);
  if (!sidebar) throw new SparkError("E_INVALID_ARGUMENT", "SidebarItem requires a Sidebar parent");
  identifier(id, "sidebar ID"); callback(onContextMenu, "context menu");
  if (parentId !== undefined) identifier(parentId, "sidebar parentId");
  flag(group, "group"); count(rowCount);
  if (group && selectable) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar group rows are not selectable");
  const [ownWidth, setOwnWidth] = useState<number>();
  if (rowHeight !== undefined && rowHeight !== "auto") finite(rowHeight, "row height", 1);
  if (typeof selectable !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected selectable boolean");
  const control = useControl({ ref, onError }, getSidebarAvailability());
  function contextMenu(event: NativeSyntheticEvent<{ x: number; y: number; pageX: number; pageY: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) {
    if (!control.active()) return;
    const data = event?.nativeEvent;
    try {
      for (const key of ["x", "y", "pageX", "pageY"] as const) finite(data?.[key], key, -Infinity);
      for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) if (typeof data[key] !== "boolean") throw new Error("Invalid modifiers");
    } catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar context menu event", { cause })); return; }
    onContextMenu?.({ id, position: { x: data.x, y: data.y }, windowPosition: { x: data.pageX, y: data.pageY }, modifiers: { alt: data.altKey, control: data.ctrlKey, meta: data.metaKey, shift: data.shiftKey } });
  }
  function itemLayout(event: NativeSyntheticEvent<{ width: number }>) {
    if (!control.active()) return;
    try { finite(event?.nativeEvent?.width, "row width"); }
    catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar row layout", { cause })); return; }
    setOwnWidth(event.nativeEvent.width);
  }
  if (control.failed) return <View {...props} style={style} ref={control.ref}>{children}</View>;
  const width = ownWidth ?? sidebar.rowWidth;
  return <NativeSidebarItem {...props} style={width === undefined ? style : [style, { width }]} ref={control.ref} itemId={id} parentId={parentId ?? ""} group={group} count={rowCount ?? -1} autoHeight={rowHeight === "auto"} rowHeight={typeof rowHeight === "number" ? rowHeight : 0} selectable={selectable} onRightClick={contextMenu} onSidebarItemLayout={itemLayout}>{children}</NativeSidebarItem>;
}
