import { useState, type ReactNode } from "react";
import { View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { appearance, callback, finite, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSplitView from "./SidebarSplitViewNativeComponent";
/** Appearance of a `SidebarSplitView`: follow the system, or force light or dark. Default `system`. */
export type SidebarSplitViewAppearance = "system" | "light" | "dark";
/** Material behind the content pane's title-bar strip (`titleBar.content.material`). Default `none`, which draws no material. */
export type SidebarSplitViewTitlebarMaterial = "none" | "glass" | "titlebar" | "headerView" | "hudWindow" | "sidebar" | "windowBackground";
/** Pane sizes in logical points, used for `initialPaneMetrics` and as the base of `SidebarSplitViewResizeEvent`. The list fields apply only with a `list` pane. */
export interface SidebarSplitViewPaneMetrics { contentHeight: number; contentWidth: number; sidebarHeight: number; sidebarWidth: number; listHeight?: number; listWidth?: number }
/**
 * Reported by `onResize` after native layout: pane sizes, the list and content x offsets and the split height, in logical points.
 * `phase` is `provisional` until the native panes are laid out, then `ready`.
 */
export interface SidebarSplitViewResizeEvent extends SidebarSplitViewPaneMetrics { listHeight: number; listWidth: number; contentX: number; listX: number; height: number; phase: "provisional" | "ready" }
/** A color laid over a pane's title-bar area: `#RRGGBB` or `#RRGGBBAA`, with `opacity` from 0 to 1 (default 1). */
export interface SplitViewTitleBarOverlay { color: string; opacity?: number }
/** Title-bar treatment for `SidebarSplitView`. `content.height` is the content title-bar height in logical points (default 0). Unknown keys throw E_UNSUPPORTED_OPTION. */
export interface SplitViewTitleBarOptions {
  content?: { height?: number; material?: SidebarSplitViewTitlebarMaterial; overlay?: SplitViewTitleBarOverlay };
  sidebar?: { overlay?: SplitViewTitleBarOverlay };
}
/** Props for `SidebarSplitView`. Widths are logical points. Defaults: `contentMinWidth` 320, `sidebarMinWidth` 180, `listMinWidth` 240, `sidebarCollapsed` false. */
export interface SidebarSplitViewProps extends Omit<SpecializedViewProps, "children"> {
  sidebar: ReactNode;
  content: ReactNode;
  /** Optional middle column (AppKit content list, as in Mail): sidebar | list | content in one native split. */
  list?: ReactNode;
  children?: never;
  appearance?: SidebarSplitViewAppearance;
  contentMinWidth?: number;
  sidebarMinWidth?: number;
  sidebarWidth?: number;
  listMinWidth?: number;
  listWidth?: number;
  sidebarCollapsed?: boolean;
  /** Used only for initial layout, before native measurements arrive. */
  initialPaneMetrics?: SidebarSplitViewPaneMetrics;
  titleBar?: SplitViewTitleBarOptions;
  onResize?: (event: SidebarSplitViewResizeEvent) => void;
}
/** Whether the native `SidebarSplitView` can render: macOS 14 and later with the native view linked. */
export function getSplitViewAvailability() { return macosViewAvailability("SidebarSplitView"); }
function metrics(value: SidebarSplitViewPaneMetrics) {
  if (!value || typeof value !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected pane metrics");
  for (const key of ["contentHeight", "contentWidth", "sidebarHeight", "sidebarWidth"] as const) finite(value[key], key);
  for (const key of ["listHeight", "listWidth"] as const) if (value[key] !== undefined) finite(value[key], key);
}
const paneKeys = ["contentHeight", "contentWidth", "sidebarHeight", "sidebarWidth", "listHeight", "listWidth"] as const;
function keys(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected title-bar options");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown title-bar option: ${key}`);
}
function overlay(value?: SplitViewTitleBarOverlay) {
  if (value === undefined) return;
  keys(value, ["color", "opacity"]);
  if (typeof value.color !== "string" || !/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value.color)) throw new SparkError("E_INVALID_ARGUMENT", "Expected #RRGGBB or #RRGGBBAA title-bar color");
  if (value.opacity !== undefined) finite(value.opacity, "overlay opacity", 0, 1);
}
/**
 * A native AppKit split view with a sidebar, an optional middle list and a content pane, each hosting React content.
 * Invalid props throw E_INVALID_ARGUMENT. Where the native view is unavailable it reports through `onError` and lays
 * the panes out in a plain row.
 */
export function SidebarSplitView({ sidebar, content, list, children, appearance: theme = "system", contentMinWidth = 320, sidebarMinWidth = 180, sidebarWidth, listMinWidth = 240, listWidth, sidebarCollapsed = false, initialPaneMetrics, titleBar = {}, onResize, ref, onError, ...props }: SidebarSplitViewProps) {
  appearance(theme); finite(contentMinWidth, "minimum content width"); finite(sidebarMinWidth, "minimum sidebar width"); finite(listMinWidth, "minimum list width");
  if (sidebarWidth !== undefined) finite(sidebarWidth, "sidebar width", sidebarMinWidth);
  if (listWidth !== undefined) finite(listWidth, "list width", listMinWidth);
  const hasList = list !== undefined && list !== null && typeof list !== "boolean" && list !== "";
  if (typeof sidebarCollapsed !== "boolean" || children !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Use named sidebar/content panes and a boolean collapsed state");
  if (initialPaneMetrics !== undefined) metrics(initialPaneMetrics);
  keys(titleBar, ["content", "sidebar"]);
  if (titleBar.content !== undefined) { keys(titleBar.content, ["height", "material", "overlay"]); if (titleBar.content.height !== undefined) finite(titleBar.content.height, "title-bar height"); }
  if (titleBar.sidebar !== undefined) keys(titleBar.sidebar, ["overlay"]);
  overlay(titleBar.content?.overlay); overlay(titleBar.sidebar?.overlay);
  const material = titleBar.content?.material ?? "none";
  if (!["none", "glass", "titlebar", "headerView", "hudWindow", "sidebar", "windowBackground"].includes(material)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid title-bar material");
  callback(onResize, "resize");
  const control = useControl({ ref, onError }, getSplitViewAvailability());
  const [paneMetrics, setPaneMetrics] = useState<SidebarSplitViewPaneMetrics | undefined>(() => initialPaneMetrics ? { ...initialPaneMetrics } : undefined);
  function resize(event: NativeSyntheticEvent<SidebarSplitViewPaneMetrics & { contentX: number; listX: number; height: number; isLayoutReady: boolean }>) {
    if (!control.active()) return;
    let value: SidebarSplitViewResizeEvent;
    try {
      const data = event?.nativeEvent; metrics(data); finite(data.listHeight, "list height"); finite(data.listWidth, "list width"); finite(data.contentX, "content x", -Infinity); finite(data.listX, "list x", -Infinity); finite(data.height, "height");
      if (typeof data.isLayoutReady !== "boolean") throw new Error("Expected layout readiness");
      value = { contentHeight: data.contentHeight, contentWidth: data.contentWidth, sidebarHeight: data.sidebarHeight, sidebarWidth: data.sidebarWidth, listHeight: data.listHeight, listWidth: data.listWidth, contentX: data.contentX, listX: data.listX, height: data.height, phase: data.isLayoutReady ? "ready" : "provisional" };
    } catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid split-view layout", { cause })); return; }
    setPaneMetrics(current => current && paneKeys.every(key => current[key] === value[key]) ? current : value);
    onResize?.(value);
  }
  if (control.failed) return <View {...props} ref={control.ref} style={[{ flexDirection: "row" }, props.style]}>{sidebarCollapsed ? null : sidebar}{list}{content}</View>;
  return <NativeSplitView {...props} ref={control.ref} appearance={theme} contentMinWidth={contentMinWidth} sidebarMinWidth={sidebarMinWidth} sidebarWidth={sidebarWidth} hasList={hasList} listMinWidth={listMinWidth} listWidth={listWidth} sidebarCollapsed={sidebarCollapsed} onSplitViewDidResize={resize}
    contentTitlebarHeight={titleBar.content?.height ?? 0} contentTitlebarMaterial={material} contentTitlebarOverlayColor={titleBar.content?.overlay?.color} contentTitlebarOverlayOpacity={titleBar.content?.overlay?.opacity ?? (titleBar.content?.overlay ? 1 : 0)}
    sidebarTitlebarOverlayColor={titleBar.sidebar?.overlay?.color} sidebarTitlebarOverlayOpacity={titleBar.sidebar?.overlay?.opacity ?? (titleBar.sidebar?.overlay ? 1 : 0)}>
    <View key="sidebar" style={{ position: "absolute", top: 0, left: 0, minWidth: 0, height: paneMetrics?.sidebarHeight, width: sidebarCollapsed ? 0 : paneMetrics?.sidebarWidth ?? sidebarWidth ?? sidebarMinWidth }}>{sidebar}</View>
    <View key="content" style={{ position: "absolute", top: 0, left: 0, minWidth: 0, overflow: "hidden", height: paneMetrics?.contentHeight, width: paneMetrics?.contentWidth }}>{content}</View>
    {hasList ? <View key="list" style={{ position: "absolute", top: 0, left: 0, minWidth: 0, height: paneMetrics?.listHeight, width: paneMetrics?.listWidth ?? listWidth ?? listMinWidth }}>{list}</View> : null}
  </NativeSplitView>;
}
