import type { MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type WindowId = string;
export type DisplayId = string;
export interface Size { width: number; height: number }
/** Pointer position in logical units relative to the containing display's top-left corner. */
export interface CursorPoint { displayId: DisplayId; x: number; y: number }
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
  /** Content width ÷ height (0.05–20) kept while the user resizes; null removes it. macOS only for now. */
  aspectRatio?: number | null;
  /** Whole-window alpha, 0–1. macOS only for now. */
  opacity?: number;
  /** Excludes the window from screenshots, recordings and screen sharing. macOS only for now. */
  contentProtection?: boolean;
  /** Mouse events pass through to whatever is behind the window. macOS only for now. */
  ignoreMouseEvents?: boolean;
  /** Native window tabs. macOS only for now. */
  tabbing?: WindowTabbingOptions;
}
/** `automatic` follows the system "Prefer tabs when opening documents" setting, `preferred` joins a tab group when shown, `disallowed` never tabs. */
export type WindowTabbingMode = "automatic" | "preferred" | "disallowed";
export interface WindowTabbingOptions {
  mode?: WindowTabbingMode;
  /** Windows with the same identifier can share a tab group. 1–200 characters. */
  identifier?: string;
}
/** The Spark windows of one tab group. A window that is not tabbed is a group of one. */
export interface WindowTabGroup {
  /** In tab order. */
  windowIds: WindowId[];
  /** Null when the selected tab is not a Spark window. */
  selectedWindowId: WindowId | null;
  tabBarVisible: boolean;
}
export interface WindowNewTabEvent { windowId: WindowId }
export type WindowOpenOptions = WindowKind & WindowAppearanceOptions & {
  id: WindowId;
  component: string;
  props?: Record<string, unknown>;
  size?: Size;
  position?: { displayId: DisplayId; x: number; y: number };
  show?: boolean;
  /** Restores the saved frame and, for a tab, its place in its saved tab group. */
  restoreBounds?: boolean;
  /** Opens as the last tab of this window's tab group and selects it. Needs `show`. macOS only for now. */
  tabbedWith?: WindowId;
  macos?: MacOSWindowOptions;
};
/** Options whose availability differs by platform; see `getWindowAvailability(option)`. */
export type WindowOption = "aspectRatio" | "opacity" | "contentProtection" | "ignoreMouseEvents" | "tabbing" | "spaces" | "simpleFullscreen" | "documentEdited" | "backgroundMaterial" | "subtitle" | "trafficLightPosition";
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
  maximized: boolean;
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
  /** The window's tab group gained, lost or reordered windows, or showed or hid its tab bar. */
  tabGroupChanged: { windowId: WindowId; tabGroup: WindowTabGroup };
  /** Another tab of the window's group was selected. */
  tabSelectionChanged: { windowId: WindowId; selectedWindowId: WindowId | null };
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
  /** Close button's offset from the window's leading top corner (top-right in right-to-left title bars), 0–500 logical units; null restores AppKit's layout. */
  trafficLightPosition?: { x: number; y: number } | null;
  /** Secondary title line below the title; empty removes it. */
  subtitle?: string;
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
  /** `default` stays on the Space it opened on, `all` shows on every Space, `active` follows the active Space. */
  spaces?: "default" | "all" | "active";
  /** Pre-Lion fullscreen: covers the screen without a new Space; the Dock and menu bar auto-hide. */
  simpleFullscreen?: boolean;
  /** The unsaved-changes dot in the close button. */
  documentEdited?: boolean;
  /** Behind-window vibrancy under the React content; `none` removes it. */
  backgroundMaterial?: "none" | "sidebar" | "windowBackground" | "hudWindow" | "popover";
}
/** Panel class and startup shell are fixed when the native window is created. */
export type MacOSWindowUpdateOptions = Omit<MacOSWindowOptions, "panelStyle">;
export type MacOSWindowEvent =
  | { type: "titleBarAction"; windowId: string; controlId: string }
  | { type: "toolbarAction"; windowId: string; itemId: string }
  | { type: "toolbarSelectionChanged"; windowId: string; itemId: string; value: string }
  | { type: "toolbarSearchChanged" | "toolbarSearchSubmitted"; windowId: string; itemId: string; value: string; shiftKey: boolean }
  | { type: "toolbarMenuAction"; windowId: string; itemId: string; action: MenuAction };
export interface MacOSWindowBoundsOptions { durationMs?: number }
export interface SetWindowBoundsOptions { macos?: MacOSWindowBoundsOptions }
export interface MacOSWindowBlurOptions { radius: number; durationMs?: number }
