# Windows

Exports: `@legendapp/spark/windows`, `/windows/macos`, `/diagnostics`. Main window is host-created with ID `'main'`; everything else is opened by your code.

## Rules

- Every command takes an explicit window ID. There is no implicit "frontmost" or "main" default; focus never decides ownership.
- On macOS, launch forwarding is scoped to the bundle ID. A re-signed clone with a changed `CFBundleIdentifier` opens its own instance and uses separate Spark file storage; keep the generated default-bundle metadata for safe legacy migration.
- Named windows are singletons. `openWindow` on a live ID rejects `E_ALREADY_EXISTS`; call `showWindow(id)` for an existing window. IDs can be reused after close.
- `openWindow` resolves when the native window and root exist, not when your data has loaded. Use `show: false` to mount content first, then `showWindow`.
- Props passed at open are JSON-serializable and immutable. Put changing data in app state, not in window props.
- Each window is a separate React root. It does not inherit React providers from another window: wrap each registered component with the providers it needs.
- `useWindowId()` throws outside a Spark window root.
- Use `createWindowsNavigator` for typed registration: props are checked against the component and identity cannot be overridden at `open`.
- Coordinates are logical units relative to one display's top-left corner (`displayId` + `x`/`y`). Bounds are the outer frame.

## Bringing a window forward

`showWindow(id)` focuses the window inside the app but does not bring an inactive app forward. Tray, popover, menu-bar and Dock-menu clicks do not activate the app, so from those handlers pass `activate: true`:

```ts
import { showWindow } from '@legendapp/spark/windows';

// From a tray / popover / menu-bar / Dock-menu click:
await showWindow('main', { activate: true });
```

Do not write `activate().then(() => showWindow(id, { focus: true }))`; use the option. `activate: true` with `focus: false` rejects `E_INVALID_ARGUMENT`.

## Open, show and close

```tsx
import type { ReactNode } from 'react';
import { createWindowsNavigator } from '@legendapp/spark/windows';

declare function Editor(props: { documentId: string }): ReactNode;

const windows = createWindowsNavigator({
  editor: { id: 'editor', component: Editor, options: { title: 'Editor', size: { width: 960, height: 720 } } },
});

export async function openEditor(documentId: string) {
  await windows.open('editor', { props: { documentId } });
}
export async function closeEditor() {
  const result = await windows.close('editor');
  if (!result.closed) console.log('Close was vetoed');
}
```

## Close guards and events

- `beforeWindowClose(id, handler)` vetoes close when the handler returns `false`, throws, or takes longer than 30 s. One guard per live window; a second registration rejects `E_BUSY`.
- `addWindowListener(id, type, listener)` is async and binds to the current native instance; it delivers future events only (no initial snapshot) and stops when that instance closes. For app-wide open/close across reused IDs use `/app` events `windowOpened` / `windowClosed`.
- For "open the main window once, reopen on Dock click" use `createPrimaryWindowLifecycle` / `usePrimaryWindowLifecycle` rather than hand-wiring `reopen`.

```ts
import { beforeWindowClose } from '@legendapp/spark/windows';

declare function hasUnsavedChanges(): boolean;
declare function confirmDiscard(): Promise<boolean>;

const guard = await beforeWindowClose('editor', async () => !hasUnsavedChanges() || await confirmDiscard());
// When the owner goes away:
await guard.remove();
```

## macOS-only options

AppKit features live in typed `macos` groups (`macos.titleBar`, `macos.toolbar`, `macos.level`, `macos.restoreOnLaunch`, `macos.startupSplitView`, `macos.representedUri`) and in `/windows/macos` (`setWindowBlur`, `focusToolbarSearch`, `setToolbarItemText`, `addMacOSWindowListener`). On Windows a requested `macos` behavior that the target cannot honor rejects `E_UNSUPPORTED_OPTION`; it is never silently ignored. Animated frames use `setWindowBounds(id, bounds, { macos: { durationMs } })`; there is no separate animate call.

Per-window appearance is a window option (`appearance: 'system' | 'light' | 'dark'`). Content that should show a native material through needs a transparent React background.

`macos.titleBar.tintColor` (`'#RRGGBBAA'` or `{ light, dark }`) lays a color over the titlebar `material` and follows the window's effective appearance; alpha below `ff` keeps the blur showing through. Without `material` in the same call it uses `titlebar`; with `material: 'none'` it is rejected. `blendingMode` and `materialState` need a `material` other than `none` or `glass` (or a `tintColor`) in the same call, or validation throws.

`/diagnostics` exposes `getStartupTiming()`; `finishWindowRestoration()` lives in `/app`.

## Platforms

macOS: shipped. Windows: development builds only; the same commands exist, `macos` groups reject. Mobile/web: not covered; do not call `/windows` from shared mobile code.
