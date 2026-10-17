import { Children, Fragment, createContext, isValidElement, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSidebar from "./SidebarNativeComponent";
import NativeSidebarItem from "./SidebarItemNativeComponent";
/** A text row for `Sidebar`'s `items`. `id` must be unique and nonempty, `label` nonempty; `selectable` defaults to true. */
export interface SidebarItemData { id: string; label: string; selectable?: boolean }
/** A `SidebarItem` row height in logical points, or `auto` to fit its content. */
export type SidebarRowHeight = number | "auto";
/** Reported by `onSelectionChange`; `id` is null when no row is selected. */
export interface SidebarSelectionEvent { id: string | null }
/** The sidebar's content size in logical points, reported by `onContentLayout`. */
export interface SidebarContentLayoutEvent { width: number; height: number }
/** Reported by a `SidebarItem`'s `onContextMenu` on a right-click, with the modifier keys held. */
export interface SidebarContextMenuEvent {
  id: string;
  /** Logical top-left coordinates within the row and the owning window's content. */
  position: { x: number; y: number };
  windowPosition: { x: number; y: number };
  modifiers: { alt: boolean; control: boolean; meta: boolean; shift: boolean };
}
/**
 * Props shared by both `Sidebar` forms. Selection is controlled: `selectedId` must name a selectable row or be null.
 * `defaultRowHeight` (default 28) and `contentInsetTop` (default 0) are logical points.
 */
export interface SidebarBaseProps extends Omit<SpecializedViewProps, "children"> {
  contentInsetTop?: number;
  defaultRowHeight?: number;
  selectedId: string | null;
  onContentLayout?: (event: SidebarContentLayoutEvent) => void;
  onSelectionChange: (event: SidebarSelectionEvent) => void;
}
/** Props for `Sidebar`: either `items` (text rows) or `SidebarItem` children, not both. */
export type SidebarProps = SidebarBaseProps & ({ items: readonly SidebarItemData[]; children?: never } | { items?: never; children: ReactNode });
/** Props for `SidebarItem`. `selectable` defaults to true; without `rowHeight` the row uses the sidebar's `defaultRowHeight`. */
export interface SidebarItemProps extends SpecializedViewProps {
  id: string;
  rowHeight?: SidebarRowHeight;
  selectable?: boolean;
  onContextMenu?: (event: SidebarContextMenuEvent) => void;
}
// Inside a Sidebar: the row width the native list reports, which React rows take, since it excludes
// the source-list insets and a scroller. Undefined until the first native layout.
const SidebarContext = createContext<{ rowWidth: number | undefined } | null>(null);
/** Whether `Sidebar` and `SidebarItem` can render: macOS 14 and later with both native views linked. */
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
/**
 * A native AppKit source-list sidebar of text `items` or React `SidebarItem` rows. Invalid props throw E_INVALID_ARGUMENT.
 * Where the native view is unavailable it reports through `onError` and renders the rows in a plain View.
 */
export function Sidebar({ items, children, selectedId, contentInsetTop = 0, defaultRowHeight = 28, onContentLayout, onSelectionChange, ref, onError, ...props }: SidebarProps) {
  finite(contentInsetTop, "content inset"); finite(defaultRowHeight, "row height", 1);
  callback(onContentLayout, "content layout");
  if (typeof onSelectionChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Sidebar selection is controlled and requires onSelectionChange");
  if (items !== undefined && (children !== undefined || !Array.isArray(items))) throw new SparkError("E_INVALID_ARGUMENT", "Use either items or SidebarItem children");
  const { selectableIds, itemsJson } = useMemo(() => {
    const rows = items === undefined ? childRows(children) : [];
    const entries = items === undefined ? rows.map(row => ({ id: row.props.id, selectable: row.props.selectable })) : items;
    const ids = new Set<string>(), selectableIds = new Set<string>();
    for (const item of entries) {
      if (!item || typeof item !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Invalid sidebar item");
      identifier(item.id, "sidebar ID");
      if (ids.has(item.id)) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar IDs must be unique"); ids.add(item.id);
      if (item.selectable !== undefined && typeof item.selectable !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected selectable boolean");
      if (items !== undefined) identifier((item as SidebarItemData).label, "sidebar label");
      if (item.selectable !== false) selectableIds.add(item.id);
    }
    return { selectableIds, itemsJson: items === undefined ? "" : JSON.stringify(items.map(({ id, label, selectable = true }) => ({ id, title: label, selectable }))) };
  }, [items, children]);
  if (selectedId !== null && !selectableIds.has(selectedId)) throw new SparkError("E_INVALID_ARGUMENT", "Selected sidebar ID must identify a selectable row");
  const control = useControl({ ref, onError }, getSidebarAvailability());
  const [selectionRevision, revise] = useState(0);
  const [rowWidth, setRowWidth] = useState<number>();
  function selection(event: NativeSyntheticEvent<{ id: string }>) {
    if (!control.active()) return;
    const id = event?.nativeEvent?.id;
    if (typeof id !== "string" || (id !== "" && !selectableIds.has(id))) { control.error(new SparkError("E_INVALID_DATA", "Invalid sidebar selection")); return; }
    revise(value => value + 1); onSelectionChange?.({ id: id || null });
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
  if (control.failed) return <View {...props} ref={control.ref}><SidebarContext.Provider value={context}>{items?.map(item => <Text key={item.id}>{item.label}</Text>) ?? children}</SidebarContext.Provider></View>;
  return <NativeSidebar {...props} ref={control.ref} itemsJson={itemsJson} selectedId={selectedId ?? ""} selectionRevision={selectionRevision} contentInsetTop={contentInsetTop} defaultRowHeight={defaultRowHeight} onSidebarLayout={layout} onSidebarRowLayout={rowLayout} onSidebarSelectionChange={selection}>
    <SidebarContext.Provider value={context}>{children}</SidebarContext.Provider>
  </NativeSidebar>;
}
/** A React-rendered row of a `Sidebar`, sized to the native list's row width. Outside a Sidebar it throws E_INVALID_ARGUMENT. */
export function SidebarItem({ id, children, rowHeight, selectable = true, onContextMenu, ref, onError, style, ...props }: SidebarItemProps) {
  const sidebar = useContext(SidebarContext);
  if (!sidebar) throw new SparkError("E_INVALID_ARGUMENT", "SidebarItem requires a Sidebar parent");
  identifier(id, "sidebar ID"); callback(onContextMenu, "context menu");
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
  if (control.failed) return <View {...props} style={style} ref={control.ref}>{children}</View>;
  return <NativeSidebarItem {...props} style={sidebar.rowWidth === undefined ? style : [style, { width: sidebar.rowWidth }]} ref={control.ref} itemId={id} autoHeight={rowHeight === "auto"} rowHeight={typeof rowHeight === "number" ? rowHeight : 0} selectable={selectable} onRightClick={contextMenu}>{children}</NativeSidebarItem>;
}
