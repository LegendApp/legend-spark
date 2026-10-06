# Overlay windows, recursive watching, and custom drag data

These extend the existing desktop modules on macOS and Windows. Rebuild the
native runtime after updating; Fast Refresh alone cannot add native behavior.
The Kitchen Sink's **Desktop foundations** section demonstrates all three.

## Nonactivating overlays

```ts
import { openWindow } from '@legendapp/spark/windows';

await openWindow({
  id: 'status', kind: 'overlay', width: 340, height: 140,
  props: { overlay: true },
});
```

`kind` is creation-only. Opening or showing an overlay does not request keyboard
focus. It defaults to borderless, transparent, always on top, without shadow,
resizing, or minimization. Explicit style options override these defaults.
Render transparent React backgrounds to reveal the desktop. Buttons can respond
to pointer input; an overlay is not suitable for keyboard text entry. It cannot
be modal. `WindowInfo.kind` distinguishes overlays from ordinary windows.

macOS uses a nonactivating NSPanel at status level, available across Spaces and
beside fullscreen apps. Windows uses a nonactivating tool window with native
composition transparency. Windows topmost behavior does not imply AppKit's
Spaces/fullscreen semantics. Click-through regions, arbitrary stacking levels,
and animated spark transitions are outside this contract.

`titleBarStyle: 'borderless'` also works for ordinary windows. Windows accepts
`default`, `hidden`, and `borderless`, plus `transparent` and `hasShadow`;
AppKit materials, traffic lights, and the `overlay` titlebar style remain
platform-specific.

## Recursive directory invalidation

```ts
import { watch } from '@legendapp/spark/files';

const subscription = await watch(libraryPath, () => scheduleRescan(), {
  recursive: true,
});
// On owner teardown:
await subscription.remove();
```

Recursive watching requires an existing directory. Nested edits, new directories,
and replacement of the watched root invalidate that root. The callback receives
the originally watched path, not a precise per-file change record. Events can be
coalesced or include unrelated sibling changes, particularly on Windows. Debounce
and rescan; do not count events or use them as an audit log. Symlink targets outside
the watched tree are not recursively followed. Replacing/removing an ancestor of
the watched root may require establishing a new watch.

macOS uses FSEvents; Windows uses subtree change notifications. Removing a
subscription is idempotent and prevents further JavaScript callbacks.

## Custom drag payloads and operation negotiation

```tsx
<DragDropView
  source={{ data: { 'application/x-my-item': JSON.stringify({ id: '42' }) } }}
  sourceOperations={['copy', 'move']}
  onDragEnd={({ accepted, operation }) => finishDrag(accepted, operation)}
>
  <Text>Drag item</Text>
</DragDropView>

<DragDropView
  acceptedTypes={['application/x-my-item']}
  acceptedOperations={['move', 'copy']}
  onDragOver={({ x, y, operation }) => updateInsertionMarker(x, y, operation)}
  onDragLeave={clearInsertionMarker}
  onDrop={({ data, operation }) => acceptItem(data, operation)}
/>
```

Custom values are strings keyed by lowercase MIME names; parsing and validation
belong to the application. Built-in types are `files`, `text`, and `urls`.
Those built-ins are accepted by default; custom types require explicit opt-in.
`text/plain`, `text/uri-list`, and the internal transport type are reserved—use
`text` and `urls` for those payloads.

Operations are `copy`, `move`, or `link`, with `copy` as the default. The target's
ordered preferences select a mutually supported operation. Empty operation/type
lists reject the drag. `onDragOver` carries target-local coordinates and the
negotiated operation without re-reading the payload on each movement.
`onDragEnd` reports the actual native result, or `none` for rejection/cancellation.
Acceptance does not mutate application data or delete files; the app owns that
work. An external application's interpretation of custom formats is its own.
Use dedicated drag handles when child controls need their own pointer gestures.

## Validation

```sh
bun run typecheck
bun run test
bun scripts/test-desktop-foundations.ts
```

The final command builds a disposable macOS development runtime with the native
test driver, verifies recursive watching and focus preservation, inspects the
AppKit overlay, and exercises custom payload/hover/move/rejection on mounted
Fabric views. Its report is `.spark/desktop-foundation-tests/report.json`.
It invokes native destination callbacks; it does not replace an OS-driven
external drag acceptance test.

The shared `bun run test:platform --platform windows` runner includes the
recursive-watch and overlay-focus cases. On Windows, use the Kitchen Sink demonstrations after rebuilding its Windows
runtime. Check background transparency over another app, pointer actions without
focus changes, hide/show, multiple monitors/DPI, nested writes and root replacement,
and custom move/rejection plus external text/file drops. The portable automated
checks can also run by launching Kitchen Sink with
`--spark-foundation-report <absolute-report-path>`; the AppKit-specific driver
checks are skipped there. Windows compilation and native acceptance are still
pending; implementation alone is not evidence that those checks passed.
