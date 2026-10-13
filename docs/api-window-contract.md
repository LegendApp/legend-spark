# Spark window API detail

Design appendix to the [full API proposal](./api-contracts.md). Implemented contract; platform validation status is recorded in [the implementation checklist](api-cleanup.md). Shared conventions and ownership rules in the main proposal take precedence.

## Canonical windows surface

### Identity and lifecycle

Use `/windows` for imperative operations, types, root context, hooks, and component registration. Remove `/windows/react`, `/windows/managed`, and `/windows/controls` after updating their in-repository callers in the same change. Internal files may separate responsibilities without exposing that organization as extra public import paths.

Every command identifies its target. Remove implicit main/frontmost defaults from the canonical contract. Main-window identity is explicit (`'main'`); `useWindowId()` reads the owning root and throws outside its provider. Focus does not determine ownership.

Named windows are singleton instances. Opening an existing live ID rejects `E_ALREADY_EXISTS`; showing/focusing an existing window is explicit. IDs may be reused after a window closes. Operations address the currently live window with that ID, not a historical instance. Listeners and close guards bind to an internal native instance token so they cannot attach to a later window reusing the ID. Commands still address the currently live ID.

The main window is host-created. Applications configure it through host configuration and manipulate it through the same live-window commands. `openWindow` does not recreate it.

### Core types

The public types live in `packages/desktop-windows/src/types.ts`. Advanced macOS groups are described below.

```ts
type WindowId = string;
type DisplayId = string;
type Size = { width: number; height: number };

// Logical units relative to one display's top-left full-screen corner.
type WindowBounds = Size & {
  displayId: DisplayId;
  x: number;
  y: number;
};

type WindowKind =
  | { kind?: 'window'; parentId?: WindowId; modal?: false }
  | { kind: 'window'; parentId: WindowId; modal: true }
  | { kind: 'overlay'; parentId?: WindowId; modal?: never };

interface WindowAppearanceOptions {
  title?: string;
  appearance?: 'system' | 'light' | 'dark';
  titleBarStyle?: 'default' | 'overlay' | 'hidden' | 'borderless';
  backgroundColor?: string;
  transparent?: boolean;
  hasShadow?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  minSize?: Size | null;
  maxSize?: Size | null;
  aspectRatio?: number | null; // content width ÷ height, 0.05–20; null removes it
  opacity?: number;            // 0–1
  contentProtection?: boolean; // excluded from screenshots, recordings and screen sharing
  ignoreMouseEvents?: boolean; // click-through
  tabbing?: { mode?: 'automatic' | 'preferred' | 'disallowed'; identifier?: string }; // native window tabs
}

type WindowOpenOptions = WindowKind & WindowAppearanceOptions & {
  id: WindowId;
  component: string; // Registered React Native component name.
  props?: Record<string, unknown>; // JSON-serializable at this boundary.
  size?: Size;
  position?: { displayId: DisplayId; x: number; y: number };
  show?: boolean; // Defaults to true.
  restoreBounds?: boolean; // Defaults to false. Also restores the window's place in its tab group.
  tabbedWith?: WindowId; // Opens as the last, selected tab of that window's group.
  macos?: MacOSWindowOptions;
};

type WindowUpdateOptions = WindowAppearanceOptions & {
  macos?: MacOSWindowUpdateOptions;
};

interface WindowInfo {
  id: WindowId;
  kind: 'window' | 'overlay';
  title: string;
  parentId: WindowId | null;
  modal: boolean;
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  maximized: boolean; // macOS zoomed / Windows IsZoomed. State changes arrive through boundsChanged.
  fullscreen: boolean;
  bounds: WindowBounds;
}

type CloseResult = { closed: true } | { closed: false; reason: 'vetoed' };

getWindowAvailability(option?: WindowOption): Availability;
openWindow(options: WindowOpenOptions): Promise<WindowInfo>;
getWindow(id: WindowId): Promise<WindowInfo>;
listWindows(): Promise<WindowInfo[]>;
setWindowOptions(id: WindowId, options: WindowUpdateOptions): Promise<void>;
setWindowBounds(id: WindowId, bounds: WindowBounds, options?: { macos?: { durationMs?: number } }): Promise<void>;
showWindow(id: WindowId, options?: { focus?: boolean }): Promise<void>;
hideWindow(id: WindowId): Promise<void>;
closeWindow(id: WindowId): Promise<CloseResult>;
minimizeWindow(id: WindowId): Promise<void>;
maximizeWindow(id: WindowId): Promise<void>;
unmaximizeWindow(id: WindowId): Promise<void>;
setWindowFullscreen(id: WindowId, fullscreen: boolean): Promise<void>;
centerWindow(id: WindowId, options?: { displayId?: DisplayId }): Promise<void>;
```

`openWindow` resolves when the native window/root exists, not when application data or layout finishes loading. A hidden opening (`show: false`) supports restoring chrome and mounting content before explicit presentation. The React navigator always loads its component before native creation. A failed loader remains retryable and leaves no native shell.

`setWindowOptions` validates all requested fields before applying them. No transactional promise across native setters is implied: native failure may leave partial changes; refresh `getWindow` to inspect state. Identity, parent/modal relationships, component, and initial props are immutable in this initial contract. Dynamic application data belongs to application state, not an implicit props-patching mechanism.

`closeWindow` waits for the actual close/veto decision. Missing windows reject `E_NOT_FOUND`; repeated calls while closing join the same decision. `showWindow` defaults to focusing. Other state commands resolve when the requested state is reached or reject if the native operation fails. No successful return merely because a message was queued.

### Coordinates and display changes

Use display-relative logical units instead of an ambiguous global coordinate system. Both platforms expose top-left origins and downward-positive Y within the identified display. Bounds describe the outer window frame; content layout sizes remain a separate React concern.

```ts
interface DisplayInfo {
  id: DisplayId;
  persistentId: string | null;
  name: string;
  primary: boolean;
  size: Size;
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number; // Physical pixels per logical unit on this display.
}
getDisplays(): Promise<DisplayInfo[]>;
// Pointer position in the same display-relative logical units as bounds.
getCursorPoint(): Promise<CursorPoint>; // { displayId; x; y }
```

For a spanning window, the display containing the largest frame area is its owning display; use the primary display to break a tie. Negative local coordinates are allowed. Native adapters convert using the selected display's scale and orientation. Explicit commands targeting a disconnected display reject; restoration may fall back to the primary display and fit the window into its work area. Persisted bounds should record their coordinate format. Development data using the old format can be explicitly reset; no legacy coordinate conversion API is needed.

With no creation position, use the parent display or primary display and center in its work area. Explicit size/position wins over restoration; restoration supplies only omitted geometry. Runtime dimensions support 100–20000 logical units; positions support ±10,000,000. Null constraints reset to that range. Host configuration alignment is tracked as a separate remaining unit.

### Events and close guards

```ts
interface WindowEventMap {
  focusChanged: { windowId: WindowId; focused: boolean };
  boundsChanged: { windowId: WindowId; bounds: WindowBounds };
  visibilityChanged: { windowId: WindowId; visible: boolean };
  fullscreenChanged: { windowId: WindowId; fullscreen: boolean };
  tabGroupChanged: { windowId: WindowId; tabGroup: WindowTabGroup };
  tabSelectionChanged: { windowId: WindowId; selectedWindowId: WindowId | null };
  closed: { windowId: WindowId };
}

addWindowListener<K extends keyof WindowEventMap>(
  id: WindowId,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: { onError?: (error: SparkError) => void },
): Promise<AsyncRegistration>;

beforeWindowClose(
  id: WindowId,
  handler: () => boolean | Promise<boolean>,
  options?: { onError?: (error: SparkError) => void },
): Promise<AsyncRegistration>;
```

Listener registration is asynchronous: native acknowledgement binds the subscription to the current instance. Listeners receive future events only; no implicit initial snapshot. They stop when the identified live instance closes and do not attach to a later instance reusing its ID. Keep one close guard per live window initially: duplicate registration rejects `E_BUSY`; `true` allows close. A thrown/rejected/timed-out decision vetoes close and reports the failure through the framework's error reporting. The native deadline is 30 seconds; timeout reports `E_TIMEOUT` through `onError` (default `console.error`). Forced OS termination cannot be vetoed.

A future observable window-state hook must subscribe and obtain its snapshot without missing intervening changes. The imperative event API alone does not promise an atomic snapshot/event handoff.

### Preserve advanced macOS functionality

Use `macos` option groups, with named public types, for features that are genuinely AppKit-specific. Do not make these groups untyped escape hatches.

| Existing capability | Canonical home |
|---|---|
| Style masks | Translate ordinary bits to common booleans/title-bar options; keep native panel styles under creation-only `macos.panelStyle`. |
| Represented URL | `macos.representedUri`, nullable for clearing. |
| Window level | `macos.level`; reject conflicting `alwaysOnTop` requests. |
| Content layout guide, title visibility, material/blending/state, traffic lights and their position, subtitle | `macos.titleBar` group. |
| Spaces, simple fullscreen, edited dot, window vibrancy | `macos.spaces`, `macos.simpleFullscreen`, `macos.documentEdited`, `macos.backgroundMaterial`. |
| Toolbar style, items, titlebar controls | Typed `macos.toolbar` and `macos.titleBar.controls`. |
| Startup split-view shell | `macos.startupSplitView`, nullable for clearing; preserve pre-React rendering. |
| Shell restoration across launches | `macos.restoreOnLaunch`, separate from common saved bounds restoration. |
| Frame animation | `macos.durationMs` group on the single `setWindowBounds` operation, with explicit duration units; the group rejects `E_UNSUPPORTED_OPTION` on Windows rather than being silently ignored. It runs on the [window choreography](#window-choreography) animator; `animateWindowBounds` is the choreography operation that also takes an easing and reports interruption and Reduce Motion. |
| Blur and toolbar focus/text commands | Explicit targeted macOS operations under `/windows/macos`. |
| Finish window restoration | Application restoration coordinator operation, not an ordinary window setter. |
| Startup timing | Diagnostics entry point, not window options. |
| Display sleep prevention | `/system` power assertion; remove the duplicate window-manager convenience API. |

`MacOSToolbarItem` is a discriminated union of button, menu, label, search, segmented and sidebarToggle items. Menu entries use the shared action/checkbox/separator/slider schema; this surface rejects submenus, shortcuts, semantic roles and image files. `addMacOSWindowListener` returns an acknowledged registration for typed title-bar, toolbar, search and menu events; slider actions carry a numeric value. Search focus may optionally replace its text, including an empty string. Segmented values may be empty strings; `null` represents no selection.

Use `/app` events `windowOpened` and `windowClosed` for application-wide registry changes across reused IDs (a pooled window emits one pair per use; see [Window pools](#window-pools)). `usePrimaryWindowLifecycle` uses those events and initializes once per owning ID under React Strict Mode. Instance-specific listeners belong to `/windows`.

`/windows/macos` exposes `setWindowBlur`, `focusToolbarSearch`, `setToolbarItemText`, `getToolbarState`, `showToolbarCustomizationPalette` and `addMacOSWindowListener`; animated bounds are an option group on the portable `/windows` `setWindowBounds`, not a second export. `/app` owns `finishWindowRestoration`; `/diagnostics` owns startup timing. The old window-manager, window-controls and React-only import paths are removed without aliases.

### Toolbar customization, display modes, overflow and visibility

Added in #72 to `macos.toolbar` (open and update) and `/windows/macos`. `getToolbarAvailability(feature?)`
from `/windows` reports each feature (`customization`, `displayMode`, `overflow`, `shown`, `sidebarToggle`):
available on macOS when the window module is present, `unsupported-platform` on Windows. Windows has no
toolbar yet; its `macos` group rejects with `E_UNSUPPORTED_OPTION` (WIN-UNSUP-01) and the `/windows/macos`
commands reject with `E_UNSUPPORTED_PLATFORM`.

| Feature | Spark | AppKit | Notes |
|---|---|---|---|
| Customization palette | `customization: { id }`, `showToolbarCustomizationPalette(id)` | `allowsUserCustomization`, `runCustomizationPalette:` | The toolbar's context menu also offers Customize Toolbar…. `null` turns it off and shows the app's `items` again. The palette is a sheet: it rejects `E_UNAVAILABLE` without customization and under the test driver, which never shows windows. |
| Persisted layout | user defaults key `<namespace>.toolbarLayout.<id>` (the app's namespace, as `restoreBounds` uses): item order, display mode, shown state | — | Each part is saved when the user changes it (items when they add or remove one; display mode; shown) and restored when a window opens or turns customization on with that `id`. Spark does not use `autosavesConfiguration`: it works through toolbar families, which mirror every change into each toolbar with the same identifier, including a closed window's toolbar that is not yet released, and AppKit throws when their items differ. Open windows with the same `id` therefore do not mirror each other; the latest change wins. Until the user adds or removes an item, the toolbar shows the app's items, so new items appear in it; a saved display mode or shown state alone doesn't change that. Once the user's items are saved, item updates keep the user's arrangement: new items appear in the palette, removed items leave. The app's changes (opening, item updates such as a new segmented value or label, `toolbarDisplayMode`, `toolbarShown`) are never saved as customizations. |
| Display modes | `displayMode: "icon" \| "label" \| "iconAndLabel"` | `NSToolbarDisplayMode` | Default `icon`, as before. AppKit shows labels only when every item responds to a click; with a `label` item in the toolbar it keeps the current mode, and Spark rejects the request with `E_UNSUPPORTED_OPTION` (other fields in the same request have been applied). |
| Overflow | automatic; `getToolbarState(id).overflowItemIds` | `visibleItems`, `menuFormRepresentation` | Items that do not fit move to AppKit's » menu. Menu buttons and segmented controls get a submenu form, rebuilt from current state when it opens (AppKit's default form for a view item only clicks the hidden view); choosing an entry sends the same `toolbarMenuAction` or `toolbarSelectionChanged` event. The label-only mode uses the same forms. |
| Show/hide | `shown: boolean` | `NSToolbar.visible` | Like View › Show/Hide Toolbar; the toolbar keeps its items. `visible: false` still removes the toolbar, and rejects `shown`, `displayMode` and `customization` in the same request. |
| Sidebar toggle | `{ type: "sidebarToggle", id, placement? }` | label, tooltip and symbol of `NSToolbarToggleSidebarItemIdentifier` | AppKit's own item (`NSToolbarToggleSidebarItem`) always sends `toggleSidebar:` through the responder chain and ignores a target, while Spark sidebars are React state. Spark builds an item with the standard item's localized label, tooltip and symbol that sends `toolbarAction` with its `id`. At most one per toolbar. |

`getToolbarState(id)` resolves `{ shown, displayMode, customizationId, itemIds, overflowItemIds }` as AppKit
has it now, after any user customization; it rejects `E_NOT_FOUND` when the window has no toolbar. The native
harness (`tests/window-manager.native.mm`) covers each row on real `NSToolbar`s, including overflow in a narrow
window that is never shown.

### Window options audit

Audit of `openWindow`/`setWindowOptions` against the Windows epic (#12), done in #65. Every
option below can be set when opening and changed later; an update publishes only the fields it
names, to the native module that owns them. "Windows" means the Windows host in
`packages/desktop-host/windows/application.inc`; this audit ran on macOS only, so the Windows
column is from reading that code, not from running it. Windows work is tracked in #243.

| Epic item | Spark option | macOS | Windows | Gap |
|---|---|---|---|---|
| Aspect ratio | `aspectRatio` (added) | `contentAspectRatio` | Rejects `E_UNSUPPORTED_OPTION` | Windows: `WM_SIZING` (#243) |
| Closable | `closable` | Style mask | System menu Close disabled, close command ignored | None |
| Minimizable | `minimizable` | Style mask | `OverlappedPresenter.IsMinimizable` | None |
| Resizable | `resizable` | Style mask | `OverlappedPresenter.IsResizable` | None |
| Min/max size | `minSize`, `maxSize` | `minSize`/`maxSize` | `WM_GETMINMAXINFO` track sizes | None |
| Levels: normal, floating, always on top | `alwaysOnTop`; `macos.level` (`normal`, `floating`, `modalPanel`, `mainMenu`, `status`, `screenSaver`) | `level` | `alwaysOnTop` only (`IsAlwaysOnTop`) | Other levels have no Windows equivalent |
| All Spaces vs active Space | `macos.spaces` (added): `default`, `all`, `active` | `collectionBehavior` | Not applicable | No public API pins a window to every virtual desktop |
| Opacity | `opacity` (added) | `alphaValue` | Rejects `E_UNSUPPORTED_OPTION` | Windows: layered window alpha (#243) |
| Background colour, transparency | `backgroundColor`, `transparent` | `backgroundColor`, `opaque` | Root composition brush, `WS_EX_NOREDIRECTIONBITMAP` | None |
| Shadow | `hasShadow` | `hasShadow` | DWM non-client rendering policy | None |
| Vibrancy / material | `macos.backgroundMaterial` (added, whole window); `macos.titleBar.material` (title bar) | `NSVisualEffectView` below the React surface | Not applicable | Windows backdrops are the Mica/Acrylic row |
| Content protection | `contentProtection` (added) | `sharingType` none / read-only | Rejects `E_UNSUPPORTED_OPTION` | Windows: `SetWindowDisplayAffinity` (#243) |
| Click-through | `ignoreMouseEvents` (added) | `ignoresMouseEvents` | Rejects `E_UNSUPPORTED_OPTION` | Windows: `WS_EX_TRANSPARENT` (#243) |
| Simple fullscreen | `macos.simpleFullscreen` (added) | Covers the screen in the current Space | Not applicable | `setWindowFullscreen` is the portable fullscreen |
| Traffic-light position | `macos.titleBar.trafficLightPosition` (added) | Moves the standard buttons | Not applicable | None |
| Title bar styles: standard, hidden, hidden-inset, unified, compact | `titleBarStyle` (`default`, `overlay`, `hidden`, `borderless`); `macos.toolbar.style` (`unified`, `unifiedCompact`, `expanded`, `preference`, `automatic`) | Style mask, title bar transparency, toolbar style | `default`, `hidden`, `borderless`; `overlay` rejects | None: standard is `default`, Electron's hidden is `overlay`, hidden-inset is `overlay` with a unified toolbar or a traffic-light position, unified/compact are toolbar styles |
| Subtitle | `macos.titleBar.subtitle` (added) | `subtitle` | Not applicable | None |
| Represented file (proxy icon) | `macos.representedUri` | `representedURL` | Not applicable | None |
| Edited dot | `macos.documentEdited` (added) | `documentEdited` | Not applicable | None |
| Mica / Acrylic | None | Not applicable | Missing | Needs a typed `windows` backdrop option (#243) |

`getWindowAvailability(option)` reports, for `WindowOption` (`aspectRatio`, `opacity`,
`contentProtection`, `ignoreMouseEvents`, `tabbing`, `spaces`, `simpleFullscreen`, `documentEdited`,
`backgroundMaterial`, `subtitle`, `trafficLightPosition`, and the special window options
`fullScreenAuxiliary`, `stationary`, `ignoresCycle` and `cornerSnapping`), whether the current platform
implements it: all of them on macOS, none on Windows (`unsupported-platform`). An unknown option
throws `E_INVALID_ARGUMENT`. Options not in the list work wherever windows do, except where the
table says otherwise. On Windows the four portable additions reject with
`E_UNSUPPORTED_OPTION` (`Windows does not support <option> yet`) before any native call, and the
`macos` group rejects as before.

Option details:

- `aspectRatio` constrains user resizing of the content area; it does not resize the window.
- `contentProtection: false` restores the default read-only sharing. AppKit's `sharingType`
  getter can keep reporting none afterwards; the window server's sharing state is correct, and the
  native test reads that.
- `trafficLightPosition` is the close button's offset from the window's leading top corner (top
  right in right-to-left title bars). The title bar container grows to center the buttons at that
  inset. It is reapplied when AppKit lays the title bar out again (resize, toolbar and title
  changes, leaving fullscreen, buttons recreated after `closable`, `minimizable` and `resizable`
  were all off) and left alone in native fullscreen. It needs a title bar; `null` restores
  AppKit's layout.
- `backgroundMaterial` adds behind-window vibrancy under the React surface, so it shows only
  where the React content is transparent. The in-process test driver renders it as flat gray (see
  [the test driver](test-driver.md#what-a-capture-contains)).
- `simpleFullscreen` sizes the window to its screen in the current Space, hides the title bar,
  traffic lights and toolbar, makes the window unmovable and not resizable, and auto-hides the Dock
  and menu bar while the app is active. While it is on, `titleBarStyle`, `resizable`, `minSize`,
  `maxSize` and `macos.titleBar` changes other than `subtitle`, and `setWindowBounds`,
  `setWindowFullscreen`, `maximizeWindow`, `unmaximizeWindow` and `centerWindow`, reject
  `E_BUSY`; turning it on while in native fullscreen rejects `E_BUSY`. Turning it off restores the
  windowed frame and the hidden chrome. `restoreBounds` and frame autosave (`restoreOnLaunch`, the
  host's `restoreFrame`) keep the windowed frame throughout. Closing the window ends it, and the
  presentation options return to their previous value when the last such window ends it.
  `WindowInfo.fullscreen` and `fullscreenChanged` report native fullscreen only. `openWindow`
  enters it after all other options are applied.

Two fixes came out of this audit: a window opened without `appearance` follows the app
(`system`, as the contract says) instead of being forced dark, and an update that sets only
`macos.representedUri` keeps the window's title instead of replacing it with the file name.

The Kitchen Sink `windows/window-options` screen opens a child window with options applied and
changes each row on the live window; its flows are in `e2e/flows/windows/`. The native tests
(`tests/window.native.mm`, run by `tests/window-native.test.ts` in left-to-right and right-to-left
title bars, and `tests/window-manager.native.mm`) assert each option's `NSWindow` property after
opening and after an update. The host configuration for the main window
(`window` in `desktop.config.json`) does not take the added options yet; set them on the main
window at run time with `setWindowOptions('main', …)`.

### Special window types

`@legendapp/spark/windows` builds the special window types (#190) out of ordinary Spark windows: each
factory opens a window with a registered root component and JSON props (`id`, `component`, `props`,
`title`, `appearance`, as `openWindow` takes them), AppKit panel styles, levels and collection
behaviors, then places and drives it. They are implemented on macOS. On Windows
`getSpecialWindowAvailability(type)` reports `unsupported-platform` and every factory rejects
`E_UNSUPPORTED_PLATFORM` before any native call; Windows work is #394. An unknown type throws
`E_INVALID_ARGUMENT`; unknown option keys reject `E_UNSUPPORTED_OPTION` and invalid values
`E_INVALID_ARGUMENT`, before anything opens. Positions are logical units from a display's top-left
corner (`DisplayRect` is `{ displayId, x, y, width, height }`). A controller serializes its commands and
rejects them with `E_CLOSED` once its window has closed, however it closed.

| Type | Factory | Window | Placement and behavior |
|---|---|---|---|
| Spotlight-style command bar | `createCommandBar({ size, hotkey?, material?, onError? })` → `CommandBar` (`show`, `hide`, `toggle`, `shown`, `remove`) | Non-activating panel, hidden title bar, floating level, every Space and over fullscreen apps, out of the ⌘` cycle, behind-window blur (`material`, default `popover`) | Hidden until shown. `show({ displayId? })` centers it horizontally on the display under the pointer (or `displayId`) with its top a fifth of the way down the work area, and gives it key focus without activating the app. It hides when it loses key focus. `hotkey` registers a global shortcut (`@legendapp/spark/global-shortcuts`) that toggles it; `remove()` unregisters it and closes the window. Failures in the hotkey or blur paths go to `onError` (default `console.error`) |
| HUD overlay | `createHUD({ size, material? })` → `HUD` (`show({ displayId?, durationMs? })`, `hide`, `shown`, `remove`) | Overlay kind: borderless, click-through, never key, status level, every Space and over fullscreen apps, HUD vibrancy | Each show centers it horizontally on the display (default primary), two thirds of the way down the work area, without focus, and hides it after `durationMs` (0–60000, default 1500; 0 keeps it). Showing again restarts the time |
| Quick Look-style preview | `openPreviewWindow({ size, from?, displayId? })` → `PreviewWindow` (`close`) | `macos.panelStyle: "hud"` (titled utility panel with the dark HUD chrome), floating level | Centered on the display of `from` (else `displayId`, else primary); with `from` (a thumbnail) it grows from it in 200 ms when it opens and shrinks back into it before it closes |
| Picture in picture | `openPictureInPicture({ size, corner?, displayId?, margin? })` → `PictureInPicture` (`snapTo(corner, { displayId? })`, `close`) | Non-activating panel, hidden title bar, floating level, every Space and over fullscreen apps, keeps `size`'s aspect ratio | Opens at `corner` (default `bottomRight`) of the work area, inset by `margin` (0–500, default 16), without focus. `macos.cornerSnapping` snaps every later move to the nearest corner (a drag snaps on mouse-up) |
| Menu bar, tray and notch popover | `openPopover({ size, anchor, dismissOnBlur?, material? })` → `Popover` (`close`) | Non-activating panel, hidden title bar, floating level, popover vibrancy | Centered 4 points below `anchor` and kept inside the display: `{ type: "rect", rect }` (a tray item's `Tray.getBounds()`), or `{ type: "notch", displayId? }`, the menu bar's center (the first display with a notch, else the primary display). Takes key focus; closes when it loses it unless `dismissOnBlur: false` |
| Above fullscreen apps and on all Spaces | `macos.spaces: "all"` with `macos.fullScreenAuxiliary: true` on any window | Collection behaviors | The command bar, HUD, picture in picture, popover, edge drawer, overlay and desktop widget all set them |
| Edge drawer | `createEdgeDrawer({ edge, thickness, length?, displayId?, material? })` → `EdgeDrawer` (`open`, `close`, `toggle`, `isOpen`, `remove`) | Non-activating panel, hidden title bar, floating level, every Space, sidebar vibrancy | Hidden past `edge` of the work area until opened; `open()` shows it there with focus and slides it in over 200 ms; `close()` slides it out and hides it. `thickness` and `length` (centered along the edge, default the whole edge) are 100–20000 |
| Transparent click-through overlay | `openOverlay({ rect?, clickThrough? })` → `WindowInfo` | Overlay kind (as the HUD), transparent and shadowless | Covers `rect` (default the whole primary display, menu bar included); mouse events pass through unless `clickThrough: false`. Close it with `closeWindow` |
| Desktop widget layer | `openDesktopWidget({ size, position, material? })` → `WindowInfo` | Borderless transparent non-activating panel at `macos.level: "desktop"` (above the desktop picture, below the desktop icons and every app window), every Space, `stationary` (left in place by Mission Control and Show Desktop), out of the ⌘` cycle | At `position`. Close it with `closeWindow` |
| Presenter mode | `startPresenterMode({ audience, controller, audienceDisplayId?, controllerDisplayId?, onEnd? })` → `PresenterMode` (`swapDisplays`, `stop`, `audienceDisplayId`, `controllerDisplayId`) | Audience: borderless, status level, filling its display above the menu bar. Controller: an ordinary window | Needs two displays (`E_UNAVAILABLE` with one) and two window IDs. The audience defaults to the first display that is not primary and the controller to the primary one; the controller is centered at `controller.size` (default 1000 × 700, fitted to the work area). `swapDisplays()` exchanges them. Presenter mode ends, closing both windows and calling `onEnd` once with `stopped`, `displayRemoved` or `windowClosed`, on `stop()`, when either display disconnects or when either window closes |

The window options the types use are public and work on any window (macOS; Windows rejects
`E_UNSUPPORTED_OPTION`):

- `macos.panelStyle: "hud"`: a titled utility panel with AppKit's HUD chrome. A `nonactivating`
  panel takes key focus when shown with focus without activating the app, and stays on screen while
  the app is inactive (`hidesOnDeactivate` off). Borderless panels cannot become key and are only
  ordered front.
- `macos.level: "desktop"`: one above the desktop picture level, below the desktop icon level.
- `macos.fullScreenAuxiliary`, `macos.stationary`, `macos.ignoresCycle`: the matching
  `NSWindowCollectionBehavior` flags (auxiliary clears fullscreen-primary, which AppKit refuses to
  combine with it).
- `macos.cornerSnapping: { margin } | null`: from the next move on, every move, by the user or by
  `setWindowBounds`, ends at the nearest corner of the owning display's work area, inset by
  `margin` (0–500), animated on screen; a drag snaps when the mouse button comes up.
- `setWindowBounds(id, bounds, { macos: { durationMs } })` animates windows that are not on screen
  too, on the [window choreography](#window-choreography) animator.
- `Tray.getBounds()` (`@legendapp/spark/tray`) returns the item's `DisplayRect` in the menu bar, for a
  popover anchor; `E_UNAVAILABLE` while the menu bar does not show it, `E_CLOSED` after `remove()`,
  `E_UNSUPPORTED_PLATFORM` on Windows (#394).

Testing: driven apps never show windows ([test driver](test-driver.md#focus-and-window-state)), so
the flows read each window's state and bounds back through the window API. Two in-app driver
commands make the types testable off screen: `simulateGlobalShortcut` presses a registered global
shortcut (driven apps never register hotkeys with the system), and `simulateDisplays` gives window
geometry simulated displays, so presenter mode runs on two displays the Mac does not have
([displays](displays.md#simulated-displays)). A driven window is never key, so blur dismissal (command
bar, popover) is covered by `tests/special-windows.test.ts`, not by a flow. The Kitchen Sink screen is
`multiwindow/special-windows`; its flows are `e2e/flows/multiwindow/special-*.yaml`. Native tests:
`tests/window.native.mm` (collection behaviors, simulated-display geometry, corner snapping),
`tests/window-manager.native.mm` (HUD panel, desktop level, non-activating panels),
`tests/tray.native.mm` (tray bounds) and `tests/global-shortcuts.native.mm` (driver hotkeys).

### Window choreography

`@legendapp/spark/windows` animates windows in and out of the elements they belong to (#189): a window
zooms out of a list row, thumbnail or panel and shrinks back into it when it closes, frames change with an
animation, closing hands key focus to the right window, and palettes and inspectors dock to a parent window.

```ts
type WindowSourceRect = DisplayRect | { windowId: WindowId; x: number; y: number; width: number; height: number };
interface WindowTransition { durationMs?: number; easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" } // 0–5000, default 250 and easeInOut
interface WindowAnimationResult { finished: boolean; reducedMotion: boolean }
getWindowChoreographyAvailability(feature: "zoom" | "frame" | "closeTransition" | "attach"): Availability;
animateWindowBounds(id, bounds: WindowBounds, transition?): Promise<WindowAnimationResult>;
stopWindowAnimation(id): Promise<void>;
openWindowFrom(options: WindowOpenOptions, zoom: { from: WindowSourceRect; closeTo?: WindowSourceRect | null; focusOnClose?: WindowId; transition? }): Promise<WindowZoom>; // { id, bounds, finished }
setWindowCloseTransition(id, value: { to: WindowSourceRect | null; focus?: WindowId; transition? } | null): Promise<void>;
attachWindow(id, parentId, options: { edge, align?, gap?, magnetic?, hideWhenInactive?, transition?, onChange?, onError? }): Promise<WindowAttachment>; // { id, parentId, attached, remove }
```

- **Sources.** A `DisplayRect` is in display coordinates. `{ windowId, x, y, width, height }` is a rectangle in that
  window's React root view from its top-left corner, what `measureInWindow` reports for a row or panel; it is read when
  the animation starts, so a window that moved since is followed. The Dock tile has no public position, so a window
  cannot zoom from the Dock icon.
- **Animator.** The native window module animates the frame and opacity on the main thread, setting each frame itself,
  so windows that are not on screen animate too. Easings are cubic (`easeIn` t³, `easeOut` 1 − (1 − t)³, `easeInOut`
  their halves). A new animation of a window, by any of these operations, `setWindowBounds` or corner snapping,
  interrupts the running one where it is: that one resolves `finished: false`, and the next starts from the current
  frame and opacity. `stopWindowAnimation` stops it where it is; closing the window stops it too.
- **Reduce Motion.** With the system setting on, frames change at once and only the opacity fades: a zoom and a close
  transition are cross-fades at the window's frame, and `animateWindowBounds` is immediate. Results say so with
  `reducedMotion: true`. Corner snapping, attachment docking and `setWindowBounds`' `macos.durationMs` follow it too.
- **Zoom.** `openWindowFrom` opens the window as `openWindow` does, hidden at its frame, then shows it with key focus
  at `from`, transparent, and grows it to its frame while it fades in. It resolves once the window is opened and the zoom is
  requested (the window shows at `from` as the zoom starts), with the frame it lands on; `finished` resolves when the zoom ends. `show: false`, `modal` and `tabbedWith` reject
  `E_INVALID_ARGUMENT`. If the zoom cannot start (the source's window or display is gone) the window closes again
  and `finished` rejects with the cause. By default the window shrinks back into `from` when it closes
  (`closeTo: null` turns that off).
- **Close transitions and focus handoff.** With a close transition, every close (`closeWindow`, the close button, ⌘W,
  the navigator's `close`) first runs the window's close guard, then shrinks the window into `to` while it fades out
  (`to: null` fades it where it is; a `to` in a window that has closed does the same), then closes it. As the shrink
  starts, key focus moves to `focus`, else the window `to` is in, else the parent window, if it is shown: never to the
  departing window, so typing goes where the content returns. Another animation of the window during the shrink
  cancels the close: `closeWindow` resolves `{ closed: false, reason: "interrupted" }` and the window stays open. A
  minimized, fullscreen, hidden or sheet window closes at once. A pooled window that shrank is parked at its frame
  and opacity from before the shrink, without the transition. Tearing a panel off into a window is `openWindowFrom`
  out of its slot; merging it back is its close transition into the slot.
- **Attached windows.** `attachWindow` docks the window at `edge` of the parent (`leading` and `trailing` follow the
  app's layout direction), aligned `start` (the top, or the leading end), `center` or `end`, `gap` points out (0–200),
  moving it there with `transition`, and resolves once it is in place. Docked, it is an AppKit child window: it moves
  with the parent as a group and follows the parent's resizes. A move of the window that ends within `magnetic`
  points (0–200, default 24) of its docked frame (a drag, when the mouse button comes up, or `setWindowBounds`) docks
  it there; one that ends farther undocks it; `onChange` and `attached` report each change. `hideWhenInactive` hides
  it while the app is inactive (`hidesOnDeactivate`). One attachment per window: attaching again replaces it, and the
  replaced handle's `remove()` does nothing. `remove()` undocks it where it is; the attachment ends when either window
  closes (the parent closing reports `attached: false`). A window cannot attach to itself, its child or its sheet
  (`E_INVALID_ARGUMENT`). An inspector that follows the parent's selection is an attached window whose content reads
  the shared selection: windows share one JavaScript runtime by default.
- **Virtual clock.** In a driver run the animator follows motion's virtual clock while it is on (`setClock`,
  `advanceClock`; the motion package reports clock changes through the driver's clock hook), so flows read exact
  frames at exact times. On the real clock it steps on a 120 Hz timer in the run loop's common modes.
- **Platforms.** macOS only. On Windows `getWindowChoreographyAvailability` reports `unsupported-platform` for every
  feature and every operation rejects `E_UNSUPPORTED_PLATFORM` before any native call (#434). An unknown feature
  throws `E_INVALID_ARGUMENT`; unknown option keys reject `E_UNSUPPORTED_OPTION` and invalid values
  `E_INVALID_ARGUMENT` before any native call. Tab groups across windows (#435) and drag-driven tear-off, merge
  preview and cross-window drag (#436) are separate tasks.

Testing: `tests/window-choreography.test.ts` covers validation, ordering and results over a mocked transport;
`tests/window.native.mm` (choreography suite) covers the animator on the virtual clock, interruption, close transitions,
focus handoff targets, Reduce Motion and attachments on real `NSWindow`s in driver mode. The Kitchen Sink screen is
`multiwindow/choreography`; its flows are `e2e/flows/multiwindow/choreography-*.yaml`.

### Window tabs

Native macOS window tabs (#64), part of `/windows`. Every operation addresses a Spark window by ID;
AppKit owns the groups, so a window that is not tabbed is a group of one.

```ts
interface WindowTabGroup {
  windowIds: WindowId[];           // Spark windows of the group, in tab order
  selectedWindowId: WindowId | null; // null when the selected tab is not a Spark window
  tabBarVisible: boolean;
}
getWindowTabGroup(id: WindowId): Promise<WindowTabGroup>;
listWindowTabGroups(): Promise<WindowTabGroup[]>; // every Spark window in exactly one group, in no particular order
selectWindowTab(id: WindowId): Promise<void>;
moveTabToNewWindow(id: WindowId): Promise<void>;  // Window ▸ Move Tab to New Window
mergeAllWindows(id: WindowId): Promise<void>;     // Window ▸ Merge All Windows, into this window's group
setWindowTabBarVisible(id: WindowId, visible: boolean): Promise<void>; // View ▸ Show/Hide Tab Bar
handleWindowNewTab(id: WindowId, handler: (event: { windowId: WindowId }) => unknown, options?: { onError? }): Promise<AsyncRegistration>;
```

- **Tabbing mode and identifier.** `tabbing.mode` is AppKit's `tabbingMode`: `automatic` (the
  default) follows the system "Prefer tabs when opening documents" setting, `preferred` joins a tab
  group when the window is shown, `disallowed` never tabs. Windows tab together only when their
  `tabbing.identifier` (`tabbingIdentifier`, 1–200 characters) matches. Both can be set at open and
  changed later; a mode change does not move a window that is already in a group. Per window type,
  put `tabbing` in the navigator entry's `options`.
- **New tabs.** `openWindow({ ..., tabbedWith })` opens the window as the last tab of that window's
  group, with its frame and tabbing identifier, and selects it. Both windows must be shown (AppKit
  keeps only shown windows in tab groups), the new one ordinary (no `parentId`, not an overlay), and
  tabbing allowed on both. `show: false`, a hidden window to join, a different `tabbing.identifier`,
  or `disallowed` on either window rejects `E_INVALID_ARGUMENT`; a missing window rejects `E_NOT_FOUND`.
- **The + button.** AppKit shows the tab bar's + button while something in the responder chain
  answers `newWindowForTab:`. `handleWindowNewTab` makes the window answer it: a click, or the
  `newTab` menu role while the window is key, calls the handler, which opens the tab with
  `tabbedWith`. One handler per window (`E_BUSY` for a second until the first is removed); removal
  hides the button; handler failures go to `onError` (default `console.error`). In the navigator, an
  entry's `newTab(instance)` returns `{ name, props?, options? }`, checked against the configuration
  like `open`, and the navigator opens that entry as a tab of the window whose + was clicked. The
  entry it names must not have a fixed `id`.
- **Select, move, merge.** `selectWindowTab` selects the window's tab. `moveTabToNewWindow` moves a
  tab out into a window of its own; for a window without other tabs it resolves without change.
  `mergeAllWindows` moves every shown window whose identifier matches, and whose tabbing is not
  `disallowed`, into the window's group; hidden windows stay. It rejects `E_INVALID_ARGUMENT` for a
  window whose own tabbing is `disallowed`.
- **Tab bar.** A group of several tabs always shows its tab bar: hiding it rejects `E_BUSY`. A window
  without other tabs shows or hides it; `disallowed` rejects `E_INVALID_ARGUMENT`.
- **Hiding and closing.** As in AppKit, `hideWindow` and closing take a window out of its group.
- **Events.** `addWindowListener(id, 'tabGroupChanged')` fires when the window's group gains, loses
  or reorders windows (including the window moving to another group) or shows or hides its tab bar;
  `tabSelectionChanged` when another tab of its group is selected. Both carry the window's own ID and
  arrive at most once per main-loop turn, after the change. AppKit has no tab notifications, so the
  window module observes each Spark window's `tabGroup` (`windows`, `selectedWindow`,
  `tabBarVisible`) with key-value observation for the window's lifetime.
- **Restoration.** With `restoreBounds`, each window's saved record (the same per-window record as
  its frame) keeps the window IDs of its tab group in tab order and whether it was the selected tab.
  When such a window is next shown, it rejoins the first open, shown window of that saved group whose
  identifier matches, after the saved tabs that precede it; it is selected only if it was the selected
  tab, otherwise the group keeps its selection. So the group comes back in its saved order whatever
  order the application reopens its windows in. Closing a window removes it from its saved group;
  quitting keeps every group. Driver mode neither reads nor saves these records. Across a JavaScript
  reload, native windows and their groups stay as they are.
- **Menus.** The menu roles `toggleTabBar`, `showAllTabs`, `selectPreviousTab`, `selectNextTab`,
  `moveTabToNewWindow` and `mergeAllWindows` are AppKit's tab actions: `target: { role }` finds the
  items AppKit adds to the Window and View menus, and `type: 'role'` items keep AppKit's validation
  (for example the Show/Hide Tab Bar title). `newTab` is the + button's `newWindowForTab:`
  ([menus](menus.md)).
- **Platforms.** macOS only. `getWindowAvailability('tabbing')` is `unsupported-platform` on Windows;
  there every function above rejects `E_UNSUPPORTED_PLATFORM`, the two listener types too, `tabbing`
  and `tabbedWith` reject `E_UNSUPPORTED_OPTION` before any native call, and a navigator entry with
  `newTab` rejects `E_UNSUPPORTED_OPTION`. Win32 has no system window tabbing; the Windows design and
  implementation are tracked in #295 (blocked on the Windows backend, #51).

**Driver mode** never shows a window (docs/test-driver.md), and several AppKit tab actions order
windows on screen. There, Spark regroups windows with the tab group's own `addWindow:`/
`removeWindow:` instead: `moveTabToNewWindow` leaves the moved window where it is, `mergeAllWindows`
joins every driver-shown window that qualifies in creation order, and when AppKit's selected window
leaves a group the other tabs leave and regroup behind the first of them, so AppKit never orders the
next tab front. Selecting a tab orders it on screen, so the driver records each selection (opening,
showing or selecting a tab) and reports the group's most recently selected tab; when that tab leaves,
the previously selected one is reported, where AppKit would select a neighbouring tab. AppKit's
automatic tabbing on show (`preferred`, or `automatic` with "Always") never runs, because nothing is
ordered front: use `tabbedWith` or `mergeAllWindows`. Group membership, order and the tab bar are
AppKit's in both modes. What only a person can check on screen: the tab bar itself, the + button, the
menu items' titles and enabled state, dragging tabs, the cascaded frame of a moved tab, and automatic
tabbing.

`tests/window.native.mm` (run by `tests/window-native.test.ts`) opens tabbed windows that never
reach the screen and asserts `NSWindow.tabGroup` membership, order and selection, the published
events and the reported groups after each operation, the restored order and selection, and that no
window was ever on screen. The Kitchen Sink `windows/window-tabs` screen runs the operations from
`spark-ks://windows/window-tabs?run=…` and its readout encodes the groups and events in test IDs
(`e2e/flows/windows/window-tabs-*.yaml`).

### Navigator: window types, singletons and multiwindow state

`createWindowsNavigator(config, options?)` is the one registration API for React window roots.
Every window it opens is an ordinary `openWindow` window with an explicit ID, the same events,
close guards and options. There is no separate multiwindow path and no Spark router.

```tsx
import { createWindowsNavigator, createWindowState, useWindowInstance } from '@legendapp/spark/windows';

export const windows = createWindowsNavigator({
  editor: {
    component: Editor,                      // no `id`: a new window per open()
    options: { title: 'Untitled', size: { width: 900, height: 640 } },
    undoMenu: true,
    menus: instance => [{ type: 'submenu', id: 'format', label: 'Format', items: [
      { type: 'action', id: 'bold', label: 'Bold', shortcut: 'CmdOrCtrl+B' },
    ] }],
    onMenuAction: (action, instance) => applyFormat(instance.id, action.itemId),
  },
  settings: { id: 'settings', loadComponent: () => import('./Settings'), options: { title: 'Settings' } },
});

const editor = await windows.openInstance('editor', { props: { documentId: 'notes' } });
await windows.openInstance('settings'); // focuses the live Settings window if one exists
await editor.close();                   // CloseResult, as closeWindow
```

The original navigator contract is unchanged and still works as before:

- `open(name, { props, options })` resolves the native `WindowInfo`. For an `id` entry it rejects
  `E_ALREADY_EXISTS` while that window is open (apps use this to show the existing window instead).
- `close(name)` resolves the `CloseResult` of `closeWindow`; `show(name)` shows and focuses;
  `getId(name)` returns the entry's ID; `prefetch(name)` loads a lazy component.
- `id` entries register their root as `spark.window.<id>` and receive their props directly.
- `close`, `show` and `getId` need an `id` entry; for other entries they fail `E_INVALID_ARGUMENT`.

Added:

- Exactly one of `component` or `loadComponent`. Loaders run before native creation; a failed
  loader leaves no native window and stays retryable.
- `id` is optional. With `id` the entry is a singleton: `openInstance` on a live window shows and
  focuses it and returns the same handle; props are not re-applied; concurrent calls share one
  native open. Without `id`, each `open`/`openInstance` creates a window with a generated ID
  (`<name>-<suffix>`), and the root is registered as `spark.window.<name>`.
- Both open methods infer props from the registered component; required props cannot be omitted.
  `options` excludes identity, component and props.
- `openInstance` resolves a `WindowInstance` once the window exists and its services are
  installed: `id`, `name`, `runtime`, `undo`, `isOpen()`, `focus()`, `close()`, `refreshMenus()`,
  `refreshToolbar()`. A closed instance rejects `focus`/`close`/`refreshToolbar` with `E_CLOSED`,
  so a stale handle never acts on a later window that reuses its ID. `close()` on a window that is already gone natively ends the instance and rejects `E_CLOSED`. Windows opened with `open`
  get the same per-window services.
- `get(windowId)`, `list(name?)`, `getKeyWindowId()` and `subscribe(listener)` observe the
  navigator's open windows. `remove()` stops the navigator's listeners and menus without closing
  windows; afterwards every method except `getId` rejects or throws `E_CLOSED`.
- `useWindowId()` works in every navigator root. `useWindowInstance()` returns the owning
  instance. Separate roots do not inherit arbitrary React providers.
- `newTab(instance)` returns the entry, props and options to open as a new tab of the window whose
  + button (or `newTab` menu role) was used; see [Window tabs](#window-tabs).
- `@legendapp/spark-native-menu` is an optional peer. It is loaded only when an entry declares
  `menus` or `undoMenu`; if it is missing then, opening that window rejects `E_MODULE_UNAVAILABLE`
  and leaves no window. Windows without menus never load it.

**Instance lifetime.** Closure is tracked per native window instance (`addWindowListener(id,
'closed')`, which binds to the instance token), never from the ID-only `/app` `windowClosed`
event. `close()` that resolves `{ closed: true }` ends the instance immediately. Opening a
singleton whose window closed natively before its event arrived detects the missing window and
opens a new one. A late close event of the earlier instance cannot dispose the new one.

After a JavaScript reload, native restarts each window's root with its original props. The root
re-adopts its instance: the navigator confirms the native window, reinstalls services and
continues. A singleton `openInstance` during that adoption waits for it and never replaces the
adopted window; `open` rejects `E_ALREADY_EXISTS` as for any open window. Generated IDs give up stable per-instance frame autosave; use `restoreBounds` on singletons.

#### Runtime model

All windows share the main JavaScript runtime by default. An entry may opt into an isolated
runtime; heavy computation belongs in workers (`ThreadedRuntime.run`, see [Runtimes](runtimes.md)).

| | Shared runtime (default) | Isolated runtime (opt-in per entry) |
|---|---|---|
| Heap | One heap; module state is shared by every window root | A named `@react-native-runtimes/core` runtime |
| State | Any observable is live in every window | Only serialized props cross the boundary |
| Spark APIs | All, in every window | Window/menu/OS UI APIs stay on the main runtime |
| Failure scope | Render errors are contained per window; uncaught async errors and long synchronous work are runtime-wide | Contained in that runtime |
| Use for | Documents, inspectors, settings, palettes | Untrusted or plugin content |

```ts
import * as Runtimes from '@react-native-runtimes/core';
createWindowsNavigator({
  plugin: { component: PluginPanel /* threadedComponent('plugin-panel', Impl) */, runtime: { isolated: 'plugins', module: Runtimes } },
});
```

The native window still belongs to the main runtime; its root renders the upstream
`Runtimes.Threaded` surface. Entries naming the same runtime share its heap. A window holds its
runtime from the moment opening starts, so the runtime is destroyed only after the last window
using it, in any navigator, has closed; a destroy still in flight completes before the next window
uses the name. Do not use a window runtime name for workers. The application passes the Runtimes
module, so apps without isolated windows keep Runtimes [pruned from production](runtimes.md#development-and-production).
`getIsolatedRuntimeAvailability()` reports whether the Runtimes native module and its surface view
are present; opening an isolated entry without them rejects `E_MODULE_UNAVAILABLE` (or
`E_UNSUPPORTED_PLATFORM`) before a native window exists. Upstream threaded surfaces are not part of
Spark's validated Runtimes support yet.

#### Window pools

A pooled entry keeps hidden windows whose React root is already mounted, so opening one only hands
it props and shows it. Pools need an entry without `id` in the shared runtime, and macOS for now:
on Windows `createWindowsNavigator` throws `E_UNSUPPORTED_OPTION` for a configuration with a `pool`
or `throttle: true` entry, and `getWindowPerformanceAvailability('pool' | 'throttle')` reports
`unsupported-platform` (#414). A configuration shared across platforms adds those fields only where
they are available:

```ts
const pooled = getWindowPerformanceAvailability('pool').available;
createWindowsNavigator({ editor: { component: Editor, ...(pooled ? { pool: {} } : {}) } });
```

```ts
const windows = createWindowsNavigator({
  editor: { component: Editor, pool: { prewarm: 1, max: 2, memoryBudgetMB: 64 }, throttle: true },
});
await windows.prewarm('editor');           // after launch settles; resolves the pool's state
const editor = await windows.openInstance('editor', { props: { documentId } }); // a warm window
windows.getPool('editor');                 // { warm, target, max, memoryBudgetMB, measuredWindowMB, memoryPressure, hits, misses, released }
await windows.trimPool();                  // close every warm window for real
```

- **Prewarm.** Nothing is pooled until `prewarm(name, count?)` starts the entry's pool. It creates
  warm windows one at a time up to `count` (default `pool.prewarm`, 1), each an ordinary hidden window
  (`show: false`, the entry's options) whose root renders nothing. After every open the pool refills
  to that target. `prewarm` rejects `E_MODULE_UNAVAILABLE` without the `@legendapp/spark-system`
  native module, which reports memory pressure.
- **Opening a warm window.** The root receives the open's props natively (the window keeps its
  NSWindow and React surface), mounts fresh content and commits it; the window gets the entry's and
  the open's appearance options, its creation title unless one is given, the open's `size` and
  `position` or its creation size centered on its creation display (the primary display once that
  one is disconnected), and the entry's toolbar, and is shown only after the content committed, so
  its first paint is the content. Opens that pass other options (`kind`,
  `parentId`, `modal`, `tabbedWith`, `restoreBounds`, `macos`) or a saved ID (`restoreSession`) open
  a new window; `getPool` counts them as misses. A warm window that does not render within 10
  seconds is closed for real and the open rejects `E_TIMEOUT`.
- **Pooling.** Once the pool has started, windows of plain opens (only options a warm window takes,
  no saved ID) park when they close (by `close()`, the close button or `closeWindow`): close guards
  run as usual, then the instance ends exactly as on close (`close()` resolves `{ closed: true }`,
  `closed` listeners run, guards and the new-tab handler are removed), the window is hidden, its
  content unmounts and the next use gets a new native instance. It is warm again while the pool is
  under `max` (0–8, default 2) and its memory budget, else it closes for real. Windows opened with
  other options or by `restoreSession`, windows already open when the pool started, and windows in
  fullscreen, minimized or attached as a sheet close for real. A window whose options changed
  during a use (`setWindowOptions`, `setWindowBlur`, `setToolbarItemText`, including
  `refreshToolbar`) also closes for real, so no use inherits another's changes; the options the
  pool itself applies when it opens a warm window do not count. Warm windows are hidden windows:
  `listWindows()` reports them, `navigator.list()` and sessions do not.
- **Application events.** `/app` `windowOpened` and `windowClosed` stay paired per use of a pooled
  window: a warm window being created emits neither, opening it emits `windowOpened`, parking emits
  `windowClosed`, and closing a parked or warm window for real emits nothing more.
- **Memory budgets.** `pool.memoryBudgetMB` (1–1024, default 64) bounds the memory an entry's warm
  windows hold. Each warm window is measured as the growth of the process footprint
  (`phys_footprint`, what Activity Monitor shows) from before it is created to its root's first
  render; the pool keeps no more warm windows than fit the median of the last five costs measured,
  releasing the oldest, so one outlier cannot empty it. `prewarm` and `trimPool` start measuring
  afresh. The Kitchen Sink's 480×320 note measured about 2 MB per warm window in driver mode (never
  drawn, so no backing store) on an M4 Max; a window that has been on screen also holds its backing
  store, about width × height × scale² × 4 bytes (1.2 MB for that note at 2x). The defaults (two
  warm windows, 64 MB) are chosen to leave room for heavier windows on the reference machine, an
  8 GB M1 MacBook Air; they have not been measured there. The budget covers warm windows only; open
  windows are the app's. Memory pressure (warning or critical) closes every warm window of every pool and pauses
  refilling until it returns to normal.
- **Release.** Closing a warm window for real closes the NSWindow and stops its React surface.
  `trimPool(name?)` does that for warm windows and stops refilling until the next `prewarm`;
  `remove()` does it for all of them, and open pooled windows close for real from then on. After a
  JavaScript reload, warm windows are released (call `prewarm` again); open pooled windows are
  adopted like any other.

#### Background render throttling

`throttle: true` stops an entry's content from re-rendering while its window is hidden, minimized or
fully covered (AppKit occlusion, also exposed as the `occlusionChanged` window event): its root
suspends with the committed content kept, so state survives and pending updates render once, when
the window is visible again. While throttled, the content's views are hidden and its layout effects
are cleaned up; they run again when it renders. Passive effects keep running; pause timers with
`visibilityChanged` and `occlusionChanged` listeners. AppKit reports visibility and occlusion after
the change, so a window that becomes visible can show its background for a frame before the content
renders again (checked by hand in `performance-manual`). Driver mode never puts a window on screen,
so it reports no occlusion and only hidden windows are throttled there.

#### Shared and scoped state

In the shared runtime the same observable is live in every window: a document opened in two
windows is one Legend State object, and an edit in one renders in the other. `createWindowState`
adds a per-window scope and promotion:

```ts
const drafts = createWindowState<Draft>({ initial: window => ({ text: '' }) });

drafts.get(editor);              // private to this window instance; freed with it
drafts.promote(editor, 'notes'); // the same observable becomes app-scoped under 'notes'
drafts.attach(other, 'notes');   // another window reads and writes the same value
drafts.release('notes');         // E_BUSY while an open window is attached
```

- Values are keyed by window instance, so a later window reusing an ID starts fresh.
- Calls for a closed window throw `E_CLOSED`; nothing is recreated for it.
- `promote` keeps the observable's identity. App-scoped values outlive their windows until
  released; there is no reference counting that could delete data when the last window closes.
- `useWindowState(state)` returns the current window's observable and re-renders when its binding
  changes, not on value changes. Read values with Legend State's `useValue`.
- Isolated windows cannot participate; they receive props.

#### Per-window routing and deep links

Spark does not own a router. Each window is its own React root, so a window renders its own
upstream navigator (for example a React Navigation container) with independent state. Deep links
use the application's routing configuration: receive the URL with `/links`, choose or open the
window, and hand the path to that window's upstream linking configuration through props.

```ts
links.addEventListener('url', event => {
  const path = routeFor(event.url);  // the app's own parsing
  if (path) void windows.openInstance('editor', { props: { initialPath: path } });
});
```

#### Messages between windows

`createWindowMessages<Requests, Broadcasts>()` sends typed requests to one window and broadcasts to
every listening window. It belongs to the shared runtime: payloads and results pass by reference in
the one heap, nothing is serialized. Code in an isolated runtime cannot use it; it receives props.

```ts
type Requests = { summary(payload: { full: boolean }): { title: string; selection: number[] } };
type Broadcasts = { themeChanged: { dark: boolean } };
export const messages = createWindowMessages<Requests, Broadcasts>();

messages.handle(editor, 'summary', ({ full }, from) => summarize(editor, full)); // Subscription
const summary = await messages.request(editor, 'summary', { full: true }, { from: inspector, timeoutMs: 5000 });
messages.addListener('themeChanged', ({ dark }, from) => apply(dark), { window: inspector });
messages.broadcast('themeChanged', { dark: true }, { from: settings }); // returns the number of listeners called
```

- `handle(window, type, handler)`: one handler per window and type; a second rejects `E_BUSY`. It is
  removed when the window closes. `from` is the sending window, or `null` for app code such as the
  main window (which is not a navigator window and so cannot be a request target).
- `request` resolves the handler's result. It rejects `E_NOT_FOUND` without a handler, `E_CLOSED`
  when the window has closed or closes first, `E_TIMEOUT` after `timeoutMs` (1–2147483647, default
  30000), or with the handler's own error. The handler always runs asynchronously, never inside the
  caller's stack.
- `broadcast` calls every listener for the type now, in registration order, except those registered
  with `window` equal to `from`, and returns how many it called. A throwing listener is reported to
  `console.error` and the rest still run. A listener with `window` ends when that window closes.
- Types are names of 1–100 letters, numbers or `_ . : -`. `remove()` drops every handler and
  listener; pending requests reject `E_CLOSED`.

#### Window sessions: exact restoration, New Window

A session is a plain JSON snapshot of a navigator's open windows that the app stores where it likes
(for example Spark settings) and opens again after a quit, a crash or a logout. Per-window UI state
(route, scroll offset, selection, split sizes) lives in a restorable window state:

```ts
const view = createWindowState({ initial: () => ({ route: '/', scrollY: 0, selected: null, split: 220 }), restorationKey: 'editor-view' });

const save = async () => settings.set('session', await windows.getSession());
windows.subscribeToSession(save); // crash-safe: after changes settle, and when a window closes
await beforeQuit(async () => { await save(); return true; }); // @legendapp/spark/app
const saved = await settings.get('session');
if (saved && !(await getAppContext()).launch.safeMode) await windows.restoreSession(saved as WindowSession);

await windows.duplicate(editor);                  // File ▸ New Window
await windows.duplicate(editor, { detached: true }); // shares nothing with the source
await windows.duplicate(editor, { tab: true });   // as the next tab (macOS)
```

- `getSession()` records each open navigator window in opening order: entry `name`, `id`, `props`
  (null without), current `title`, `visible`, `bounds` with the display's `persistentId`
  (`persistentDisplayId`), and `state`: the window's private value of every state created with a
  `restorationKey`, by key. It also records tab groups of two or more saved windows (macOS) and the
  key window. A tab of a shown group is saved as visible (AppKit reports background tabs as not
  visible); a group with no visible window is saved as hidden, ungrouped windows. A restorable value that is not finite, acyclic JSON rejects `E_INVALID_DATA`.
  App-scoped values (`promote`/`share`) are the app's own data and are not part of the session.
- `restoreSession(session)` validates the whole session before opening anything: an unknown entry
  rejects `E_NOT_FOUND`, malformed data (missing or extra keys, bad IDs or bounds, a fixed-`id` entry
  saved under another ID) `E_INVALID_DATA`, and an ID that is already open `E_ALREADY_EXISTS`, also
  when another open or restore takes it while this one runs. Windows reopen with their saved IDs
  (so `restoreBounds` records and other per-ID data stay with them), props, titles and visibility, at
  the saved frame passed as explicit `position` and `size`. A frame whose display is no longer
  connected moves to the primary display, fitted into its work area, as the coordinate rules allow.
  Tab groups reopen together in tab order (`tabbedWith`), then the saved tab is selected and the
  saved key window focused. A warm or parked pooled window that holds a saved ID closes for real first, so the saved
  window can open with it. Each restorable state starts from its saved value on first access; a
  saved key whose state does not exist yet (its module is not loaded) is kept and saved again. If a
  window fails to open, the windows this restore opened are closed and it rejects with that failure.
  It resolves the windows in the session's order. An app with a removed entry filters
  `session.windows` itself first.
- `duplicate(source, options?)` is New Window: a window of the source's entry (not a fixed-`id`
  entry: `E_INVALID_ARGUMENT`) with its props (`options.props` merged over them), its current title,
  and its frame cascaded by 24 logical units, kept inside the display's work area; `options.options`
  overrides any of that. Every window state starts attached to the same app-scoped value as the
  source, or with a JSON copy of the source's restorable private value; non-restorable private values
  start from `initial`. `detached: true` copies attached restorable values instead, so the new window
  shares nothing. `tab: true` opens it as the next tab of the source's group instead of cascading.
  An attached value released before the duplicate first reads it rejects `E_NOT_FOUND` there rather
  than starting from `initial`.
- `subscribeToSession(listener)` notifies when the session may have changed: a window opened,
  closed, moved, resized, was shown or hidden, was retitled with `setWindowOptions`, or changed tab
  group, the key window changed, or a restorable value changed. Changes coalesce on a 250 ms
  trailing timer, so a scroll or live resize notifies at most four times a second; a window closing
  notifies at once. The navigator has no quit hook: save from `beforeQuit` too. Frames, visibility and tab groups
  are observed natively only while it has listeners.
- `getWindowSessionAvailability(feature?)` is the windows availability; `'tabs'` (tab groups in
  sessions, `duplicate` with `tab`) is macOS only for now. On Windows, sessions carry no tab groups,
  and restoring one with tab groups or `tab: true` rejects `E_UNSUPPORTED_OPTION` before opening
  anything (window tabs on Windows: #295).
- Driver mode applies explicit frames, so restored and duplicated frames are exact there too.

#### Workspaces

A workspace is a named, saved window layout: a navigator session plus the displays it was saved on. Apps save
and restore them from Window ▸ Workspaces and its shortcuts; restoring adapts the layout to the displays
connected now (#191).

```ts
const workspaces = await createWindowWorkspaces(windows, {
  menu: { requestName: () => promptForName(), saveShortcut: 'CmdOrCtrl+Alt+S', restoreShortcuts: ['Ctrl+CmdOrCtrl+1', 'Ctrl+CmdOrCtrl+2'] },
});
await workspaces.save('Writing');            // the open windows and the connected displays
const result = await workspaces.restore('Writing');
// { restored: true, windows, placements: [{ windowId, displayId, layout: 'exact' | 'moved' | 'scaled' }] }
// or { restored: false, reason: 'vetoed' | 'interrupted', windowId, rolledBack }
// or { restored: false, reason: 'failed', error, rolledBack }
await workspaces.list(); await workspaces.rename('Writing', 'Draft'); await workspaces.delete('Draft');
await workspaces.setMenuLabels({ window: 'نافذة', workspaces: 'مساحات العمل', save: 'حفظ مساحة العمل…' }); // language change
```

- **Storage.** `<getDirectory('data')>/workspaces.json` in the app's container, written atomically through
  `@legendapp/spark/files`, as `{ version: 1, workspaces: WindowWorkspace[] }`. Each `WindowWorkspace` is
  `{ name, savedAt, displays, session, fullscreenWindowIds }`; `displays` records each display's `id`,
  `persistentId`, `primary` and `workArea`. Reads validate the whole file: JSON that does not parse, another
  version, missing or extra keys, a window on a display the workspace does not record, a fullscreen ID that is
  not one of its windows, a fullscreen ID listed twice, a negative `savedAt` or a name used twice rejects
  `E_INVALID_DATA` with the file's path, and so do a file over 4 MB (checked before it is read), more than 100
  workspaces and more than 200 windows in one; saving past those limits rejects `E_INVALID_ARGUMENT`. A corrupt
  file is never overwritten: every operation keeps rejecting until `clear()` deletes it. A missing file is an
  empty list. Every operation reads the file again, and changes are written with compare and swap
  (`writeTextIfUnchanged`; a missing file is created only if it is still missing): a save racing another
  controller or process is retried on the new file and keeps the other's workspace, and a file that keeps changing
  rejects `E_BUSY`.
- **Names.** 1–100 characters, no control characters or surrounding spaces (`E_INVALID_ARGUMENT`). Saving a
  name again replaces that workspace in place; `list()` keeps first-save order. `rename` to a taken name rejects
  `E_ALREADY_EXISTS`; unknown names reject `E_NOT_FOUND`. Operations run one at a time in call order.
- **Restore.** The navigator first checks the saved session as `restoreSession` does (entries, data, tab
  support), so a workspace of a removed entry rejects before anything closes. Then it closes the navigator's open
  windows in opening order, each through its close guard (a window that already closed is skipped, one gone
  natively counts as closed). A vetoed or interrupted close stops the restore with `restored: false`. Then
  `restoreSession` opens the adapted session (releasing parked pooled windows that hold saved IDs), and windows
  saved in native fullscreen enter fullscreen again (on macOS each gets its own Space). If a window fails to open
  or enter fullscreen, the windows it opened are closed and it resolves `{ restored: false, reason: 'failed',
  error }`. Whenever a restore stops after closing windows, it first reopens them from the session it read before
  closing anything (`rolledBack: true`; a rollback failure goes to `onError` and gives `rolledBack: false`), so the
  app is not left without its windows.
- **Not saved.** Attachments (`attachWindow`), close transitions and other runtime relationships are not part of a
  session and are not restored; the app attaches again after a restore. A fullscreen window's saved frame is its
  fullscreen frame (AppKit exposes no public pre-fullscreen frame), so after leaving fullscreen a restored window
  keeps a display-sized frame.
- **Displays.** Each saved display maps to a connected one: the display with the same `persistentId` (when neither
  has one, the same display ID); else, for
  the saved primary, the primary display; else the first display not yet taken; else the primary display.
  On the same display with the same work area a frame is `exact`. On a display whose work area has the same
  size it keeps its place (`moved`). Otherwise it keeps its proportions: position and size scale with the work
  area, then it is fitted into it (`scaled`), so a window on the right half of a disconnected monitor lands on the
  right half of the laptop display.
- **Menu.** With `menu`, a Window ▸ Workspaces submenu: Save Workspace… (asks `requestName`; `null` cancels)
  and, after a separator, one item per workspace in list order with `restoreShortcuts[i]`. It is published
  before `createWindowWorkspaces` resolves and updated after every change; failures go to `onError` (default
  `console.error`). Labels are English unless `labels` is passed; `setMenuLabels` relabels it. The item merges into
  the app's Window menu and sets its title, so `labels.window` must be that menu's title in the app's language.
  Each workspace name keeps one item ID for the controller's lifetime, so a click names the workspace its item
  showed even while the menu updates, and item IDs carry the controller's owner ID, so two controllers never share
  one. Needs `@legendapp/spark-native-menu`
  (`E_MODULE_UNAVAILABLE` without it). `remove()` withdraws the menu; later calls reject `E_CLOSED`.
  Pick shortcuts the app's menus do not use: in the Kitchen Sink an item with ⌃⌘S (the standard Show Sidebar
  shortcut) had no key equivalent in the driver's menu snapshot, while ⌥⌘S and ⌃⌘1–9 did (#446).
- **Spaces, Stage Manager.** macOS has no public API to read or set which Space a window is on, to place a
  window on another Space, or to read or change Stage Manager's state or sets; Spark does not use private
  window-server API for them. What is possible: windows restore on the active Space, Stage Manager arranges
  them as it does any new windows, windows whose entry sets `macos.spaces` (join all Spaces, move to the active
  Space) keep that behavior because the entry's options apply again, and fullscreen windows come back in
  fullscreen in Spaces of their own.
- **Platforms.** macOS only. `getWindowWorkspaceAvailability()` reports `missing-module` without the
  file-system native module; on Windows it reports `unsupported-platform` and `createWindowWorkspaces` rejects
  `E_UNSUPPORTED_PLATFORM` before any native call. Windows virtual desktops have a public API
  (`IVirtualDesktopManager`) and Snap Layouts do not; both are part of the Windows task (#445).

Testing: `tests/windows-workspaces.test.ts` covers storage, validation and limits, compare and swap, display adaptation,
close vetoes, rollback, fullscreen and the menu over mocked modules; `tests/windows-pool.test.ts` restores a pooled
window's session and workspace. The Kitchen Sink screen is `multiwindow/workspaces`; its flows are
`e2e/flows/multiwindow/workspaces-*.yaml`.

#### Undo, keyboard, menus and toolbar per window

- Every instance owns an undo stack (`instance.undo`: `push({ label, undo, redo })`, `undo()`,
  `redo()`, `clear()`, `getState()`, `subscribe`), capped at 100 entries. `useUndoState()`
  observes the current window's stack.
- The menu bar follows the key window. The navigator tracks focus for its windows and publishes
  one menu contribution: the key window's `menus(instance)` items, plus Edit ▸ Undo/Redo bound to
  its stack when `undoMenu: true` (native `undo`/`redo` roles on macOS, accelerator actions on
  Windows). Actions go to `onMenuAction(action, instance)` of the window whose items are published.
  With no key window the contribution is withdrawn. Changes are coalesced to at most one menu
  update per tick, and the menu skips unchanged trees.
- Keyboard scope uses `/shortcuts/commands`: pass the hotkey router as `options.hotkeys`; an
  entry's `hotkeys.definitions` and `handlers(instance)` register with
  `scope: { kind: 'window', windowId }` and are removed when the window closes.
- `macos.toolbar(instance)` supplies the toolbar at open, `instance.refreshToolbar()` re-applies
  it, and `macos.onToolbarEvent(event, instance)` receives that window's toolbar events. Skipped on
  Windows by definition.

#### Error isolation

Each root has its own error boundary. A render error replaces only that window's content with a
fallback offering **Try again** (remounts the content) and **Close window**, and reports
`{ windowId, name, phase, error }` to `options.onError` (default `console.error`). Menu, toolbar,
hotkey and `newTab` handler failures are reported the same way. Pass `errorFallback` to localize the fallback;
the default renders English strings. Setup is not partial: if a window's services cannot be
installed, the window is closed and `open` rejects with the original failure. An uncaught async
error or a synchronous infinite loop in the shared runtime still affects every window; use an
isolated runtime when that matters.

#### Status

The navigator, state, undo, menu, hotkey, toolbar and error-boundary behavior is implemented in
shared JavaScript and covered by unit tests against mocked native modules
(`tests/windows-navigator.test.ts`, including the original navigator contract; `tests/windows-navigator-menuless.test.ts` without the menu module).
Messages and sessions are covered the same way by `tests/windows-session.test.ts`, pools and throttling by `tests/windows-pool.test.ts`;
`tests/window.native.mm` checks that a window reopened at the bounds another window reported has the same
bounds and frame in driver mode. The `multiwindow` session-restore, session-relaunch, duplicate and messages
flows run on macOS with the in-app driver (`--backend driver`). The other `multiwindow` flows do not
run on the driver yet (most use `focusWindow`, which needs a black-box backend); nothing has run on Windows yet (#51). The commands router behind window hotkeys requires macOS.
