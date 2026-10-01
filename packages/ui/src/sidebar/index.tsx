import { Children, Fragment, createContext, isValidElement, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSidebar from "./SidebarNativeComponent";
import NativeSidebarItem from "./SidebarItemNativeComponent";
export interface SidebarItemData { id: string; label: string; selectable?: boolean }
export type SidebarRowHeight = number | "auto";
export interface SidebarSelectionEvent { id: string | null }
export interface SidebarContentLayoutEvent { width: number; height: number }
export interface SidebarContextMenuEvent {
  id: string;
  /** Logical top-left coordinates within the row and the owning window's content. */
  position: { x: number; y: number };
  windowPosition: { x: number; y: number };
  modifiers: { alt: boolean; control: boolean; meta: boolean; shift: boolean };
}
export interface SidebarBaseProps extends Omit<SpecializedViewProps, "children"> {
  contentInsetTop?: number;
  defaultRowHeight?: number;
  selectedId: string | null;
  onContentLayout?: (event: SidebarContentLayoutEvent) => void;
  onSelectionChange?: (event: SidebarSelectionEvent) => void;
}
export type SidebarProps = SidebarBaseProps & ({ items: readonly SidebarItemData[]; children?: never } | { items?: never; children: ReactNode });
export interface SidebarItemProps extends SpecializedViewProps {
  id: string;
  rowHeight?: SidebarRowHeight;
  selectable?: boolean;
  onContextMenu?: (event: SidebarContextMenuEvent) => void;
}
const SidebarContext = createContext(false);
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
export function Sidebar({ items, children, selectedId, contentInsetTop = 0, defaultRowHeight = 28, onContentLayout, onSelectionChange, ref, onError, ...props }: SidebarProps) {
  finite(contentInsetTop, "content inset"); finite(defaultRowHeight, "row height", 1);
  callback(onContentLayout, "content layout"); callback(onSelectionChange, "selection");
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
  if (control.failed) return <View {...props} ref={control.ref}><SidebarContext.Provider value>{items?.map(item => <Text key={item.id}>{item.label}</Text>) ?? children}</SidebarContext.Provider></View>;
  return <NativeSidebar {...props} ref={control.ref} itemsJson={itemsJson} selectedId={selectedId ?? ""} selectionRevision={selectionRevision} contentInsetTop={contentInsetTop} defaultRowHeight={defaultRowHeight} onSidebarLayout={layout} onSidebarSelectionChange={selection}>
    <SidebarContext.Provider value>{children}</SidebarContext.Provider>
  </NativeSidebar>;
}
export function SidebarItem({ id, children, rowHeight, selectable = true, onContextMenu, ref, onError, ...props }: SidebarItemProps) {
  if (!useContext(SidebarContext)) throw new SparkError("E_INVALID_ARGUMENT", "SidebarItem requires a Sidebar parent");
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
  if (control.failed) return <View {...props} ref={control.ref}>{children}</View>;
  return <NativeSidebarItem {...props} ref={control.ref} itemId={id} autoHeight={rowHeight === "auto"} rowHeight={typeof rowHeight === "number" ? rowHeight : 0} selectable={selectable} onRightClick={contextMenu}>{children}</NativeSidebarItem>;
}
