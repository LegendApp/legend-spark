import type { MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
/** Identifies a window: 1–100 letters, numbers, underscores or hyphens. The host creates the window `main`. */
export type WindowId = string;
/** Identifies a connected display. */
export type DisplayId = string;
/** A width and height in logical units. */
export interface Size { width: number; height: number }
/** Pointer position in logical units relative to the containing display's top-left corner. */
export interface CursorPoint { displayId: DisplayId; x: number; y: number }
/** Outer frame in logical units from the identified display's top-left corner. */
export interface WindowBounds extends Size { displayId: DisplayId; x: number; y: number }
/** A connected display as `getDisplays` reports it. Sizes and the work area are logical units; `scaleFactor` is physical pixels per logical unit. */
export interface DisplayInfo {
  id: DisplayId;
  persistentId: string | null;
  name: string;
  primary: boolean;
  size: Size;
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}
/** A window's kind and parent: an ordinary window, optionally a child of `parentId`; a modal child of a required, distinct parent; or an overlay, which cannot be modal. */
export type WindowKind =
  | { kind?: "window"; parentId?: WindowId; modal?: false }
  | { kind: "window"; parentId: WindowId; modal: true }
  | { kind: "overlay"; parentId?: WindowId; modal?: never };
/** Appearance and behavior options that both `openWindow` and `setWindowOptions` take. */
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
/** Native window tab behavior (`tabbing`). macOS only for now. */
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
/** Passed to a `handleWindowNewTab` handler: the window whose new-tab button or `newTab` command was used. */
export interface WindowNewTabEvent { windowId: WindowId }
/**
 * Options for `openWindow`. `component` names a registered window component and `props` must be plain, acyclic JSON.
 * `size` (100–20000) and `position` are logical units, `position` from its display's top-left corner.
 */
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
export type WindowOption = "aspectRatio" | "opacity" | "contentProtection" | "ignoreMouseEvents" | "tabbing" | "spaces" | "simpleFullscreen" | "documentEdited" | "backgroundMaterial" | "subtitle" | "trafficLightPosition"
  | "fullScreenAuxiliary" | "stationary" | "ignoresCycle" | "cornerSnapping";
/** Toolbar capabilities beyond items and style; see `getToolbarAvailability(feature)`. */
export type ToolbarFeature = "customization" | "displayMode" | "overflow" | "shown" | "sidebarToggle";
/** Options for `setWindowOptions`: the appearance options plus the `macos` groups that can change after creation. */
export interface WindowUpdateOptions extends WindowAppearanceOptions { macos?: MacOSWindowUpdateOptions }
/** A window's current state, as `openWindow`, `getWindow` and `listWindows` report it. */
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
/** `interrupted`: another animation of the window cancelled its close transition (docs/api-window-contract.md#window-choreography). */
export type CloseResult = { closed: true } | { closed: false; reason: "vetoed" | "interrupted" };
/** Options for `showWindow`. `focus` defaults to true. */
export interface ShowWindowOptions { focus?: boolean }
/** Options for `centerWindow`: the display to center on. */
export interface CenterWindowOptions { displayId?: DisplayId }
/** The payload `addWindowListener` delivers for each event type. Tab events and `occlusionChanged` are macOS only. */
export interface WindowEventMap {
  focusChanged: { windowId: WindowId; focused: boolean };
  boundsChanged: { windowId: WindowId; bounds: WindowBounds };
  visibilityChanged: { windowId: WindowId; visible: boolean };
  /** Whether any part of the window is visible on screen (AppKit occlusion). macOS only; never sent in test driver mode, where no window is on screen. */
  occlusionChanged: { windowId: WindowId; occluded: boolean };
  fullscreenChanged: { windowId: WindowId; fullscreen: boolean };
  /** The window's tab group gained, lost or reordered windows, or showed or hid its tab bar. */
  tabGroupChanged: { windowId: WindowId; tabGroup: WindowTabGroup };
  /** Another tab of the window's group was selected. */
  tabSelectionChanged: { windowId: WindowId; selectedWindowId: WindowId | null };
  closed: { windowId: WindowId };
}
/** A button in the window's title bar (`macos.titleBar.controls`); pressing it sends `titleBarAction` with its `id`. `symbol` is an SF Symbol name. */
export interface MacOSTitleBarControl {
  id: string;
  label?: string;
  placement?: "left" | "right";
  disabled?: boolean;
  selected?: boolean;
  symbol?: string;
  tooltip?: string;
}
/** AppKit title-bar options (`macos.titleBar`). macOS only. */
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
/** One segment of a `segmented` toolbar item; selecting it sends `toolbarSelectionChanged` with its `value`. `symbol` is an SF Symbol name. */
export interface MacOSToolbarSegment { value: string; label: string; symbol?: string }
interface ToolbarEntry { id: string; label?: string; placement?: "leading" | "trailing" }
type ToolbarMenuEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean; icon?: { type: "symbol"; name: string } };
type ToolbarMenuItem =
  | { type: "separator" }
  | (ToolbarMenuEntry & { type: "action" })
  | (ToolbarMenuEntry & { type: "checkbox"; checked: boolean })
  | (ToolbarMenuEntry & { type: "slider"; min: number; max: number; value: number; suffix?: string });
/** An item of `macos.toolbar.items`: button, menu, label, search, segmented or sidebarToggle. IDs are unique within a toolbar; `width` is 1–20000 logical units. */
export type MacOSToolbarItem =
  | (ToolbarEntry & { type: "button"; disabled?: boolean; bordered?: boolean; symbol?: string; tooltip?: string; monospacedDigits?: boolean; width?: number })
  | (ToolbarEntry & { type: "menu"; disabled?: boolean; bordered?: boolean; symbol?: string; tooltip?: string; width?: number; items: readonly ToolbarMenuItem[] })
  | (ToolbarEntry & { type: "label"; text: string; width?: number })
  | (ToolbarEntry & { type: "search"; disabled?: boolean; collapses?: boolean; placeholder?: string; value?: string; width?: number })
  | (ToolbarEntry & { type: "segmented"; segments: readonly MacOSToolbarSegment[]; value: string | null })
  /** The standard sidebar button, with AppKit's symbol, localized label and tooltip. Pressing it sends `toolbarAction` with this ID; the app toggles its sidebar. At most one per toolbar. */
  | (Omit<ToolbarEntry, "label"> & { type: "sidebarToggle" });
/** Whether toolbar items show icons, labels or both. */
export type MacOSToolbarDisplayMode = "icon" | "label" | "iconAndLabel";
/** The window's AppKit `NSToolbar` (`macos.toolbar`). macOS only; see `getToolbarAvailability`. */
export interface MacOSToolbarOptions {
  /** Attaches (`true`) or removes (`false`) the toolbar. Setting `items`, `shown`, `displayMode` or `customization` also attaches one. */
  visible?: boolean;
  style?: "automatic" | "expanded" | "preference" | "unified" | "unifiedCompact";
  items?: readonly MacOSToolbarItem[];
  /** Shows or hides an attached toolbar like View › Show/Hide Toolbar; the toolbar keeps its items. Default `true`. */
  shown?: boolean;
  /**
   * How items render. Default `icon`. AppKit shows labels only (`label`) when every item responds to a click,
   * so a toolbar with a `label` item rejects it with `E_UNSUPPORTED_OPTION`.
   */
  displayMode?: MacOSToolbarDisplayMode;
  /**
   * Lets the user rearrange, add and remove items (Customize Toolbar… in the toolbar's context menu, or
   * `showToolbarCustomizationPalette`) and change the display mode and shown state. Spark saves the user's
   * layout in the app's user defaults under `id` and restores it whenever a window opens with the same `id`
   * (the latest change wins; open windows do not mirror each other). Until the user customizes it, the toolbar
   * shows `items`. Later item updates keep the user's arrangement: new items appear in the palette, removed
   * items leave the toolbar. `displayMode` and `shown` passed with customization apply and are saved; omit them
   * to keep the user's choice. `null` turns customization off and shows `items` again.
   */
  customization?: { id: string } | null;
}
/** A toolbar as `getToolbarState` reads it from AppKit. */
export interface MacOSToolbarState {
  shown: boolean;
  displayMode: MacOSToolbarDisplayMode;
  /** The customization ID, or null when the user cannot customize this toolbar. */
  customizationId: string | null;
  /** Item IDs in toolbar order, after any user customization. */
  itemIds: string[];
  /** Items that do not fit the window's width and are in the toolbar's overflow menu (»). Empty while the toolbar is hidden. */
  overflowItemIds: string[];
}
/**
 * A native sidebar split-view shell drawn before React renders (`macos.startupSplitView`); `null` removes it. The main
 * window's shell is saved in user defaults for the next launch. Widths are 0–20000 logical units; colors are #RRGGBB or #RRGGBBAA.
 */
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
/** AppKit-specific window options (`macos`). Rejects `E_UNSUPPORTED_OPTION` off macOS. */
export interface MacOSWindowOptions {
  /** An NSPanel. `nonactivating` takes key focus without activating the app; `hud` is a titled utility panel with AppKit's dark HUD chrome. */
  panelStyle?: "utility" | "documentModal" | "nonactivating" | "hud";
  representedUri?: string | null;
  /** `desktop` is above the desktop picture and below the desktop icons and every app window (desktop widgets). */
  level?: "normal" | "floating" | "modalPanel" | "mainMenu" | "status" | "screenSaver" | "desktop";
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
  /** Shows in another app's fullscreen Space instead of switching away from it (with `spaces: "all"`: above fullscreen apps). */
  fullScreenAuxiliary?: boolean;
  /** Stays put when Mission Control and Show Desktop move the other windows aside. */
  stationary?: boolean;
  /** Left out of the ⌘` window cycle. */
  ignoresCycle?: boolean;
  /** From the next move on, every move ends at the nearest corner of the display's work area, inset by `margin` (0–500); a drag snaps on mouse-up. Null turns it off. */
  cornerSnapping?: { margin: number } | null;
}
/** Panel class and startup shell are fixed when the native window is created. */
export type MacOSWindowUpdateOptions = Omit<MacOSWindowOptions, "panelStyle">;
/** An event `addMacOSWindowListener` delivers: a title-bar control, toolbar item, segment, search field or toolbar menu entry was used. */
export type MacOSWindowEvent =
  | { type: "titleBarAction"; windowId: string; controlId: string }
  | { type: "toolbarAction"; windowId: string; itemId: string }
  | { type: "toolbarSelectionChanged"; windowId: string; itemId: string; value: string }
  | { type: "toolbarSearchChanged" | "toolbarSearchSubmitted"; windowId: string; itemId: string; value: string; shiftKey: boolean }
  | { type: "toolbarMenuAction"; windowId: string; itemId: string; action: MenuAction };
/** macOS options for `setWindowBounds`: `durationMs` animates the move (0–60000 ms, default 0). */
export interface MacOSWindowBoundsOptions { durationMs?: number }
/** Options for `setWindowBounds`. The `macos` group rejects `E_UNSUPPORTED_OPTION` off macOS. */
export interface SetWindowBoundsOptions { macos?: MacOSWindowBoundsOptions }
/** Options for `setWindowBlur`: the blur `radius` (0–1000) and an optional animation `durationMs` (0–60000, default 0). */
export interface MacOSWindowBlurOptions { radius: number; durationMs?: number }
