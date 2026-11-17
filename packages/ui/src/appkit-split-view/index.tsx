import { useState, type ReactNode } from "react";
import { View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { appearance, callback, finite, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSplitView from "./SidebarSplitViewNativeComponent";
export type SidebarSplitViewAppearance = "system" | "light" | "dark";
export type SidebarSplitViewTitlebarMaterial = "none" | "glass" | "titlebar" | "headerView" | "hudWindow" | "sidebar" | "windowBackground";
export interface SidebarSplitViewPaneMetrics { contentHeight: number; contentWidth: number; sidebarHeight: number; sidebarWidth: number; listHeight?: number; listWidth?: number; inspectorHeight?: number; inspectorWidth?: number }
export interface SidebarSplitViewPaneOrigins { sidebarX: number; sidebarY: number; contentX: number; contentY: number; listX: number; listY: number; inspectorX: number; inspectorY: number }
/** A pane that is absent or collapsed reports a zero width and height. */
export interface SidebarSplitViewResizeEvent extends SidebarSplitViewPaneMetrics, SidebarSplitViewPaneOrigins { listHeight: number; listWidth: number; inspectorHeight: number; inspectorWidth: number; height: number; phase: "provisional" | "ready" }
export interface SplitViewTitleBarOverlay { color: string; opacity?: number }
export interface SplitViewTitleBarOptions {
  content?: { height?: number; material?: SidebarSplitViewTitlebarMaterial; overlay?: SplitViewTitleBarOverlay };
  sidebar?: { overlay?: SplitViewTitleBarOverlay };
}
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
  /** Optional trailing inspector pane (AppKit's inspector split item, as in Xcode or Keynote). The user can collapse it; `toggleInspector:` in a menu or toolbar does too. */
  inspector?: ReactNode;
  /** Defaults to 220. */
  inspectorMinWidth?: number;
  /** Initial inspector width; afterwards the user's drag owns it. Defaults to `inspectorMinWidth`. */
  inspectorWidth?: number;
  /** Applied when its value changes, like `sidebarCollapsed`. */
  inspectorCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  /** Used only for initial layout, before native measurements arrive. */
  initialPaneMetrics?: SidebarSplitViewPaneMetrics;
  titleBar?: SplitViewTitleBarOptions;
  onResize?: (event: SidebarSplitViewResizeEvent) => void;
  /** Fires when AppKit collapses or expands the sidebar itself (View > Hide Sidebar, the toolbar button). Not called for `sidebarCollapsed` changes. */
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** Fires when AppKit collapses or expands the inspector itself (the user, `toggleInspector:`). Not called for `inspectorCollapsed` changes. */
  onInspectorCollapsedChange?: (collapsed: boolean) => void;
}
export function getSplitViewAvailability() { return macosViewAvailability("SidebarSplitView"); }
function metrics(value: SidebarSplitViewPaneMetrics) {
  if (!value || typeof value !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected pane metrics");
  for (const key of ["contentHeight", "contentWidth", "sidebarHeight", "sidebarWidth"] as const) finite(value[key], key);
  for (const key of ["listHeight", "listWidth", "inspectorHeight", "inspectorWidth"] as const) if (value[key] !== undefined) finite(value[key], key);
}
const paneKeys = ["contentHeight", "contentWidth", "sidebarHeight", "sidebarWidth", "listHeight", "listWidth", "inspectorHeight", "inspectorWidth", "sidebarX", "sidebarY", "contentX", "contentY", "listX", "listY", "inspectorX", "inspectorY"] as const;
const originKeys = ["sidebarX", "sidebarY", "contentX", "contentY", "listX", "listY", "inspectorX", "inspectorY"] as const;
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
export function SidebarSplitView({ sidebar, content, list, children, appearance: theme = "system", contentMinWidth = 320, sidebarMinWidth = 180, sidebarWidth, listMinWidth = 240, listWidth, inspector, inspectorMinWidth = 220, inspectorWidth, inspectorCollapsed = false, sidebarCollapsed = false, initialPaneMetrics, titleBar = {}, onResize, onSidebarCollapsedChange, onInspectorCollapsedChange, ref, onError, ...props }: SidebarSplitViewProps) {
  appearance(theme); finite(contentMinWidth, "minimum content width"); finite(sidebarMinWidth, "minimum sidebar width"); finite(listMinWidth, "minimum list width");
  if (sidebarWidth !== undefined) finite(sidebarWidth, "sidebar width", sidebarMinWidth);
  if (listWidth !== undefined) finite(listWidth, "list width", listMinWidth);
  finite(inspectorMinWidth, "minimum inspector width");
  if (inspectorWidth !== undefined) finite(inspectorWidth, "inspector width", inspectorMinWidth);
  const present = (pane: ReactNode) => pane !== undefined && pane !== null && typeof pane !== "boolean" && pane !== "";
  const hasList = present(list), hasInspector = present(inspector);
  if (typeof inspectorCollapsed !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "inspectorCollapsed must be a boolean");
  if (typeof sidebarCollapsed !== "boolean" || children !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Use named sidebar/content panes and a boolean collapsed state");
  if (initialPaneMetrics !== undefined) metrics(initialPaneMetrics);
  keys(titleBar, ["content", "sidebar"]);
  if (titleBar.content !== undefined) { keys(titleBar.content, ["height", "material", "overlay"]); if (titleBar.content.height !== undefined) finite(titleBar.content.height, "title-bar height"); }
  if (titleBar.sidebar !== undefined) keys(titleBar.sidebar, ["overlay"]);
  overlay(titleBar.content?.overlay); overlay(titleBar.sidebar?.overlay);
  const material = titleBar.content?.material ?? "none";
  if (!["none", "glass", "titlebar", "headerView", "hudWindow", "sidebar", "windowBackground"].includes(material)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid title-bar material");
  callback(onResize, "resize"); callback(onSidebarCollapsedChange, "sidebar collapsed change"); callback(onInspectorCollapsedChange, "inspector collapsed change");
  const control = useControl({ ref, onError }, getSplitViewAvailability());
  const [paneMetrics, setPaneMetrics] = useState<SidebarSplitViewPaneMetrics & Partial<SidebarSplitViewPaneOrigins> | undefined>(() => initialPaneMetrics ? { ...initialPaneMetrics } : undefined);
  function resize(event: NativeSyntheticEvent<SidebarSplitViewPaneMetrics & SidebarSplitViewPaneOrigins & { height: number; isLayoutReady: boolean }>) {
    if (!control.active()) return;
    let value: SidebarSplitViewResizeEvent;
    try {
      const data = event?.nativeEvent; metrics(data); finite(data.listHeight, "list height"); finite(data.listWidth, "list width"); finite(data.inspectorHeight!, "inspector height"); finite(data.inspectorWidth!, "inspector width"); for (const key of originKeys) finite(data[key], key, -Infinity); finite(data.height, "height");
      if (typeof data.isLayoutReady !== "boolean") throw new Error("Expected layout readiness");
      value = { contentHeight: data.contentHeight, contentWidth: data.contentWidth, sidebarHeight: data.sidebarHeight, sidebarWidth: data.sidebarWidth, listHeight: data.listHeight, listWidth: data.listWidth, inspectorHeight: data.inspectorHeight!, inspectorWidth: data.inspectorWidth!, sidebarX: data.sidebarX, sidebarY: data.sidebarY, contentX: data.contentX, contentY: data.contentY, listX: data.listX, listY: data.listY, inspectorX: data.inspectorX, inspectorY: data.inspectorY, height: data.height, phase: data.isLayoutReady ? "ready" : "provisional" };
    } catch (cause) { control.error(new SparkError("E_INVALID_DATA", "Invalid split-view layout", { cause })); return; }
    setPaneMetrics(current => current && paneKeys.every(key => current[key] === value[key]) ? current : value);
    onResize?.(value);
  }
  const collapsedChange = (pane: string, listener?: (collapsed: boolean) => void) => (event: NativeSyntheticEvent<{ collapsed: boolean }>) => {
    if (!control.active()) return;
    const collapsed = event?.nativeEvent?.collapsed;
    if (typeof collapsed !== "boolean") { control.error(new SparkError("E_INVALID_DATA", `Invalid ${pane} collapsed state`)); return; }
    listener?.(collapsed);
  };
  if (control.failed) return <View {...props} ref={control.ref} style={[{ flexDirection: "row" }, props.style]}>{sidebarCollapsed ? null : sidebar}{list}{content}{inspectorCollapsed ? null : inspector}</View>;
  return <NativeSplitView {...props} ref={control.ref} appearance={theme} contentMinWidth={contentMinWidth} sidebarMinWidth={sidebarMinWidth} sidebarWidth={sidebarWidth} hasList={hasList} listMinWidth={listMinWidth} listWidth={listWidth} sidebarCollapsed={sidebarCollapsed} onSplitViewDidResize={resize} onSidebarCollapsedChange={collapsedChange("sidebar", onSidebarCollapsedChange)}
    hasInspector={hasInspector} inspectorMinWidth={inspectorMinWidth} inspectorWidth={inspectorWidth} inspectorCollapsed={inspectorCollapsed} onInspectorCollapsedChange={collapsedChange("inspector", onInspectorCollapsedChange)}
    contentTitlebarHeight={titleBar.content?.height ?? 0} contentTitlebarMaterial={material} contentTitlebarOverlayColor={titleBar.content?.overlay?.color} contentTitlebarOverlayOpacity={titleBar.content?.overlay?.opacity ?? (titleBar.content?.overlay ? 1 : 0)}
    sidebarTitlebarOverlayColor={titleBar.sidebar?.overlay?.color} sidebarTitlebarOverlayOpacity={titleBar.sidebar?.overlay?.opacity ?? (titleBar.sidebar?.overlay ? 1 : 0)}>
    <View key="sidebar" style={{ position: "absolute", top: paneMetrics?.sidebarY ?? 0, left: paneMetrics?.sidebarX ?? 0, minWidth: 0, height: paneMetrics?.sidebarHeight, width: paneMetrics?.sidebarWidth ?? (sidebarCollapsed ? 0 : sidebarWidth ?? sidebarMinWidth) }}>{sidebar}</View>
    <View key="content" style={{ position: "absolute", top: paneMetrics?.contentY ?? 0, left: paneMetrics?.contentX ?? 0, minWidth: 0, overflow: "hidden", height: paneMetrics?.contentHeight, width: paneMetrics?.contentWidth }}>{content}</View>
    {hasList ? <View key="list" style={{ position: "absolute", top: paneMetrics?.listY ?? 0, left: paneMetrics?.listX ?? 0, minWidth: 0, height: paneMetrics?.listHeight, width: paneMetrics?.listWidth ?? listWidth ?? listMinWidth }}>{list}</View> : null}
    {hasInspector ? <View key="inspector" style={{ position: "absolute", top: paneMetrics?.inspectorY ?? 0, left: paneMetrics?.inspectorX ?? 0, minWidth: 0, height: paneMetrics?.inspectorHeight, width: paneMetrics?.inspectorWidth ?? (inspectorCollapsed ? 0 : inspectorWidth ?? inspectorMinWidth) }}>{inspector}</View> : null}
  </NativeSplitView>;
}
