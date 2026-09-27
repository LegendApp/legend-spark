# Spark window API detail

Design appendix to the [full API proposal](./api-contracts.md). Proposed, not implemented. Shared conventions and ownership rules in the main proposal take precedence.

## Canonical windows surface

### Identity and lifecycle

Use `/windows` for imperative operations, types, root context, hooks, and component registration. Remove `/windows/react`, `/windows/managed`, and `/windows/controls` after updating their in-repository callers in the same change. Internal files may separate responsibilities without exposing that organization as extra public import paths.

Every command identifies its target. Remove implicit main/frontmost defaults from the canonical contract. Main-window identity is explicit (`'main'`); `useWindowId()` reads the owning root and throws outside its provider. Focus does not determine ownership.

Named windows are singleton instances. Opening an existing live ID rejects `E_ALREADY_EXISTS`; showing/focusing an existing window is explicit. IDs may be reused after a window closes. Operations address the currently live window with that ID, not a historical instance. If future applications need instance-safe references across ID reuse, add native generation tokens and handles as a separate feature.

The main window is host-created. Applications configure it through host configuration and manipulate it through the same live-window commands. `openWindow` does not recreate it.

### Proposed core types

The following is a proposed public shape, not executable implementation. Advanced macOS types are specified below.

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
}

type WindowOpenOptions = WindowKind & WindowAppearanceOptions & {
  id: WindowId;
  component: string; // Registered React Native component name.
  props?: Record<string, unknown>; // JSON-serializable at this boundary.
  size?: Size;
  position?: { displayId: DisplayId; x: number; y: number };
  show?: boolean; // Defaults to true.
  restoreBounds?: boolean; // Defaults to false.
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
  fullscreen: boolean;
  bounds: WindowBounds;
}

type CloseResult = { closed: true } | { closed: false; reason: 'vetoed' };

getWindowAvailability(): Promise<Availability>;
openWindow(options: WindowOpenOptions): Promise<WindowInfo>;
getWindow(id: WindowId): Promise<WindowInfo>;
listWindows(): Promise<WindowInfo[]>;
setWindowOptions(id: WindowId, options: WindowUpdateOptions): Promise<void>;
setWindowBounds(id: WindowId, bounds: WindowBounds): Promise<void>;
showWindow(id: WindowId, options?: { focus?: boolean }): Promise<void>;
hideWindow(id: WindowId): Promise<void>;
closeWindow(id: WindowId): Promise<CloseResult>;
minimizeWindow(id: WindowId): Promise<void>;
maximizeWindow(id: WindowId): Promise<void>;
unmaximizeWindow(id: WindowId): Promise<void>;
setWindowFullscreen(id: WindowId, fullscreen: boolean): Promise<void>;
centerWindow(id: WindowId, options?: { displayId?: DisplayId }): Promise<void>;
```

`openWindow` resolves when the native window/root exists, not when application data or layout finishes loading. A hidden opening (`show: false`) supports restoring chrome and mounting content before explicit presentation. Component load failure is rejected by the React navigator before native creation when preloading is requested; otherwise the navigator closes its incomplete native window and rejects.

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
```

For a spanning window, the display containing the largest frame area is its owning display; use the primary display to break a tie. Negative local coordinates are allowed. Native adapters convert using the selected display's scale and orientation. Explicit commands targeting a disconnected display reject; restoration may fall back to the primary display and fit the window into its work area. Persisted bounds should record their coordinate format. Development data using the old format can be explicitly reset; no legacy coordinate conversion API is needed.

With no creation position, use the parent display or primary display and center in its work area. Explicit size/position wins over restoration; restoration supplies only omitted geometry. Numeric ranges and supported native limits need validation shared by runtime and config schema.

### Events and close guards

```ts
interface WindowEventMap {
  focusChanged: { windowId: WindowId; focused: boolean };
  boundsChanged: { windowId: WindowId; bounds: WindowBounds };
  visibilityChanged: { windowId: WindowId; visible: boolean };
  fullscreenChanged: { windowId: WindowId; fullscreen: boolean };
  closed: { windowId: WindowId };
}

addWindowListener<K extends keyof WindowEventMap>(
  id: WindowId,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
): Subscription;

beforeWindowClose(
  id: WindowId,
  handler: () => boolean | Promise<boolean>,
): Promise<AsyncRegistration>;
```

Listeners receive future events only; no implicit initial snapshot. They stop when the identified live instance closes and do not attach to a later instance reusing its ID. Keep one close guard per live window initially: duplicate registration rejects `E_BUSY`; `true` allows close. A thrown/rejected/timed-out decision vetoes close and reports the failure through the framework's error reporting. Specify the existing native timeout before publishing this guarantee; do not silently change it in an adapter. Forced OS termination cannot be vetoed.

A future observable window-state hook must subscribe and obtain its snapshot without missing intervening changes. The imperative event API alone does not promise an atomic snapshot/event handoff.

### Preserve advanced macOS functionality

Use `macos` option groups, with named public types, for features that are genuinely AppKit-specific. Do not make these groups untyped escape hatches.

| Existing capability | Canonical home |
|---|---|
| Style masks | Translate ordinary bits to common booleans/title-bar options; keep genuinely native panel styles under `macos.panelStyle`. |
| Represented URL | `macos.representedUri`, nullable for clearing. |
| Window level | `macos.level`; reject conflicting `alwaysOnTop` requests. |
| Content layout guide, title visibility, material/blending/state, traffic lights | `macos.titleBar` group. |
| Toolbar style, items, titlebar controls | Typed `macos.toolbar` and `macos.titleBar.controls`. |
| Startup split-view shell | `macos.startupSplitView`, nullable for clearing; preserve pre-React rendering. |
| Shell restoration across launches | `macos.restoreOnLaunch`, separate from common saved bounds restoration. |
| Frame animation | Options on a macOS bounds operation, with explicit duration units; do not silently ignore on Windows. |
| Blur and toolbar focus/text commands | Explicit targeted macOS operations under `/windows/macos`. |
| Finish window restoration | Application restoration coordinator operation, not an ordinary window setter. |
| Startup timing | Diagnostics entry point, not window options. |
| Display sleep prevention | `/system` power assertion; remove the duplicate window-manager convenience API. |

Toolbar events should become typed events: menu slider values must be numeric payloads, not `${id}:${number}` strings. The exact shared menu schema belongs to the next design slice. Specify and test the replacement toolbar types, then update all callers and delete the old types in the same change. The replacement schema is still to be designed; compatibility types are not part of the proposal.

### React registration and navigation

Retain `createWindowsNavigator` with these semantics:

- Exactly one of `component` or `loadComponent` per entry.
- `id` in registration; callers cannot override identity in `open`.
- `open(name, { props, options })` infers props from that named component.
- `options` excludes identity, registered component and props; native component names stay internal to registration.
- `close(name)` returns the same `CloseResult` as imperative close.
- `getId(name)`, `prefetch(name)`, and `show(name)` remain simple conveniences.
- Distinguish named singleton windows from any future multi-instance navigator explicitly.
- `useWindowId()` requires a provider and reports the actual root owner.
- Focus/close hooks use fresh handlers and dispose on root changes/unmount.

Example of the intended consumer experience:

```tsx
import { createWindowsNavigator, useWindowId } from '@legendapp/spark/windows';

const windows = createWindowsNavigator({
  editor: {
    id: 'editor',
    component: Editor,
    options: { title: 'Editor', size: { width: 960, height: 720 } },
  },
});

await windows.open('editor', { props: { documentId: 'notes' } });
await windows.show('editor');
const result = await windows.close('editor');
```

Type-level acceptance: `documentId` is checked against `Editor` props, required props cannot be omitted, and an identifier override fails compilation. Separate roots still do not inherit arbitrary React providers; the navigator must not imply that they do.

