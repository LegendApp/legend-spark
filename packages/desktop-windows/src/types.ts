export type WindowId = string;
export type DisplayId = string;
export interface Size { width: number; height: number }
/** Outer frame in logical units from the identified display's top-left corner. */
export interface WindowBounds extends Size { displayId: DisplayId; x: number; y: number }
export interface DisplayInfo {
  id: DisplayId;
  persistentId: string | null;
  name: string;
  primary: boolean;
  size: Size;
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}
export type WindowKind =
  | { kind?: "window"; parentId?: WindowId; modal?: false }
  | { kind: "window"; parentId: WindowId; modal: true }
  | { kind: "overlay"; parentId?: WindowId; modal?: never };
export interface WindowAppearanceOptions {
  title?: string;
  appearance?: "system" | "light" | "dark";
  titleBarStyle?: "default" | "overlay" | "hidden" | "borderless";
  backgroundColor?: string;
  transparent?: boolean;
  hasShadow?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  /** Null clears this constraint back to the supported 100–20000 logical-unit range. */
  minSize?: Size | null;
  maxSize?: Size | null;
}
export type WindowOpenOptions = WindowKind & WindowAppearanceOptions & {
  id: WindowId;
  component: string;
  props?: Record<string, unknown>;
  size?: Size;
  position?: { displayId: DisplayId; x: number; y: number };
  show?: boolean;
  restoreBounds?: boolean;
  macos?: MacOSWindowOptions;
};
export interface WindowUpdateOptions extends WindowAppearanceOptions { macos?: MacOSWindowUpdateOptions }
export interface WindowInfo {
  id: WindowId;
  kind: "window" | "overlay";
  title: string;
  parentId: WindowId | null;
  modal: boolean;
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  fullscreen: boolean;
  bounds: WindowBounds;
}
export type CloseResult = { closed: true } | { closed: false; reason: "vetoed" };
export interface ShowWindowOptions { focus?: boolean }
export interface CenterWindowOptions { displayId?: DisplayId }
export interface WindowEventMap {
  focusChanged: { windowId: WindowId; focused: boolean };
  boundsChanged: { windowId: WindowId; bounds: WindowBounds };
  visibilityChanged: { windowId: WindowId; visible: boolean };
  fullscreenChanged: { windowId: WindowId; fullscreen: boolean };
  closed: { windowId: WindowId };
}
export interface MacOSTitleBarControl {
  id: string;
  label?: string;
  placement?: "left" | "right";
  disabled?: boolean;
  selected?: boolean;
  symbol?: string;
  tooltip?: string;
}
export interface MacOSTitleBarOptions {
  contentLayout?: "contentLayoutGuide" | "fullSize";
  transparent?: boolean;
  titleVisibility?: "visible" | "hidden";
  separator?: "automatic" | "none" | "line" | "shadow";
  material?: "none" | "glass" | "titlebar" | "headerView" | "hudWindow" | "sidebar" | "windowBackground";
  blendingMode?: "behindWindow" | "withinWindow";
  materialState?: "active" | "inactive" | "followsWindowActiveState";
  trafficLights?: boolean;
  controls?: readonly MacOSTitleBarControl[];
}
export interface MacOSToolbarSegment { value: string; label: string; symbol?: string }
interface ToolbarEntry { id: string; label?: string; placement?: "leading" | "trailing" }
type ToolbarMenuEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean; icon?: { type: "symbol"; name: string } };
type ToolbarMenuItem =
  | { type: "separator" }
  | (ToolbarMenuEntry & { type: "action" })
  | (ToolbarMenuEntry & { type: "checkbox"; checked: boolean })
  | (ToolbarMenuEntry & { type: "slider"; min: number; max: number; value: number; suffix?: string });
export type MacOSToolbarItem =
  | (ToolbarEntry & { type: "button"; disabled?: boolean; bordered?: boolean; symbol?: string; tooltip?: string; monospacedDigits?: boolean; width?: number })
  | (ToolbarEntry & { type: "menu"; disabled?: boolean; bordered?: boolean; symbol?: string; tooltip?: string; width?: number; items: readonly ToolbarMenuItem[] })
  | (ToolbarEntry & { type: "label"; text: string; width?: number })
  | (ToolbarEntry & { type: "search"; disabled?: boolean; collapses?: boolean; placeholder?: string; value?: string; width?: number })
  | (ToolbarEntry & { type: "segmented"; segments: readonly MacOSToolbarSegment[]; value: string | null });
export interface MacOSToolbarOptions {
  visible?: boolean;
  style?: "automatic" | "expanded" | "preference" | "unified" | "unifiedCompact";
  items?: readonly MacOSToolbarItem[];
}
export interface MacOSStartupSplitViewOptions {
  sidebarWidth: number;
  sidebarMinWidth: number;
  contentMinWidth: number;
  sidebarCollapsed?: boolean;
  appearance: "light" | "dark";
  backgroundColor: string;
  sidebarBackgroundColor: string;
  contentTitlebarHeight?: number;
}
export interface MacOSWindowOptions {
  panelStyle?: "utility" | "documentModal" | "nonactivating";
  representedUri?: string | null;
  level?: "normal" | "floating" | "modalPanel" | "mainMenu" | "status" | "screenSaver";
  titleBar?: MacOSTitleBarOptions;
  toolbar?: MacOSToolbarOptions;
  startupSplitView?: MacOSStartupSplitViewOptions | null;
  restoreOnLaunch?: boolean;
}
/** Panel class and startup shell are fixed when the native window is created. */
export type MacOSWindowUpdateOptions = Omit<MacOSWindowOptions, "panelStyle">;
export type MacOSWindowEvent =
  | { type: "titleBarAction"; windowId: string; controlId: string }
  | { type: "toolbarAction"; windowId: string; itemId: string }
  | { type: "toolbarSelectionChanged"; windowId: string; itemId: string; value: string }
  | { type: "toolbarSearchChanged" | "toolbarSearchSubmitted"; windowId: string; itemId: string; value: string; shiftKey: boolean }
  | { type: "toolbarMenuAction"; windowId: string; itemId: string; action: import("@legendapp/spark-desktop-app/src/contracts/menu").MenuAction };
export interface MacOSSetWindowBoundsOptions { durationMs?: number }
export interface MacOSWindowBlurOptions { radius: number; durationMs?: number }
