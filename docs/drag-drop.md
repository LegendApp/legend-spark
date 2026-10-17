# Drag and drop

`@legendapp/spark/drag-drop` exports one `DragDropView` for sources and destinations on macOS and Windows. It accepts ordinary React Native `ViewProps` and preserves its children when the native capability is unavailable.

```tsx
import { DragDropView } from '@legendapp/spark/drag-drop';

<DragDropView
  acceptedTypes={['files', 'application/x-my-item']}
  acceptedOperations={['copy', 'move']}
  onDrop={({ files, data, operation, x, y }) => handleDrop({ files, data, operation, x, y })}
  onError={reportError}
>
  <Text>Drop here</Text>
</DragDropView>

<DragDropView
  source={{ data: { 'application/x-my-item': JSON.stringify({ id: '42' }) } }}
  sourceOperations={['copy', 'move']}
  onDragEnd={({ accepted, operation }) => finishDrag(accepted, operation)}
  onError={reportError}
>
  <Text>Drag this item</Text>
</DragDropView>
```

Payload representations can coexist: `files` contains absolute native paths (local file URLs in a source are normalized), `text` is a string, `urls` contains absolute URLs, and `data` maps custom lowercase MIME names to UTF-8 strings. Applications own custom JSON schemas, validation, and domain models such as music tracks. `text/plain`, `text/uri-list`, and `application/x-spark-drag` are reserved; use the built-in fields for text and URLs. Windows sources support a single URL; requesting several rejects `E_UNSUPPORTED_OPTION` instead of silently exporting only the first to other applications.

Sources must contain at least one representation. `sourceOperations` defaults to `['copy']`. Destinations default to built-in accepted types (`files`, `text`, `urls`) and `['copy']`; custom types require explicit opt-in. The first mutually supported target operation wins. Empty accepted operations/types reject all drops, and `disabled` disables both directions. Accepted types decide whether a drop is eligible; payloads can include coexisting built-in representations. Custom data is limited to the requested custom types.

`onDragEnter` and `onDrop` receive `DropEvent`. `onDragOver` receives just `{ x, y, operation, allowedOperations? }`; coordinates use logical units from the destination's top-left corner, positive downward. `onDragLeave` has no payload. `onDragEnd` distinguishes `{ accepted: true, operation: 'copy' | 'move' | 'link' }` from `{ accepted: false, operation: 'none' }`. Acceptance reports native negotiation, not successful application persistence; a move requires the application to coordinate source deletion safely.

## macOS features

`getDragDropAvailability(feature)` reports each of these. On Windows they report `unsupported-platform`, and a `DragDropView` that requests one throws `SparkError` `E_UNSUPPORTED_PLATFORM` while rendering; nothing is substituted (Windows implementation: [#365](https://github.com/LegendApp/legend-spark/issues/365)).

| Feature | Props |
|---|---|
| `promisedFiles` | `source.promisedFiles`, `onPromisedFileWrite` |
| `springLoading` | `springLoading`, `onSpringLoad`, `onSpringLoadHighlight` |
| `dragImage` | `dragImage` |
| `operationMasks` | `sourceOperations: { withinApp, outsideApp }`, `ignoreModifierKeys`, `allowedOperations` in events |
| `tearOff` | `tearOff`, `onTearOff` |

### Promised files

A source can promise files that exist only once a destination such as a Finder folder accepts them (`NSFilePromiseProvider`):

```tsx
<DragDropView
  source={{ promisedFiles: [{ name: 'Report.csv', type: 'text/csv' }] }}
  sourceOperations={{ withinApp: ['copy'], outsideApp: ['copy'] }}
  onPromisedFileWrite={({ name, path }) => writeText(path, exportReport())}
>
  <Text>Report.csv</Text>
</DragDropView>
```

Each promised file is `{ name, type? }`: a file name without a folder, unique in the source, and an optional MIME type (default: from the name's extension). `onPromisedFileWrite` is required with `promisedFiles`. It receives the file's `name` and the absolute `path` the destination chose, writes the file there, and resolves once it is written; the destination waits for it on a background queue, never on the main thread. A rejection gives the destination an error and reports `E_UNAVAILABLE` through `onError`. A write unanswered after 60 seconds gives the destination an error and reports `E_TIMEOUT`. Writes still pending when the view unmounts fail. Finder is expected to take a promised file as a copy, so include `copy` in the operations allowed outside the app (a real Finder drop is not yet tested here: #118). Spark destinations do not receive promised files from other apps.

### Spring-loaded destinations

With `springLoading`, a destination spring-loads when a drag of an accepted type hovers over it for the system's spring-loading delay (or force-clicks it): `onSpringLoad` fires, and the application opens what the destination represents, as Finder opens a folder. `onSpringLoadHighlight` reports the highlight to draw: `standard` while the drag hovers, `emphasized` while the system flashes it before activating, and `none`. A spring-loading destination still accepts drops as configured.

### Drag images

`dragImage` replaces the default document symbol under the pointer: `'view'` drags a snapshot of the source view at its own position, and `{ path, width, height }` an image file (absolute path or file URL; size in points, 1-1024) centered on the pointer. A missing or unreadable image file starts no drag and reports `E_NOT_FOUND` through `onError`; a view without size reports `E_UNAVAILABLE`.

### Tear-off

With `tearOff`, a source tears off: a drag of it that no destination accepts and that ends outside every window of the app calls `onTearOff` (after `onDragEnd` with `accepted: false`) with `{ x, y, width, height }`, where the view landed. It is the view's frame moved with the pointer, in its window's content from the top-left corner, as `measureInWindow` reports it, so it is usually outside the window's bounds. With the window's ID it is a `WindowContentRect`: open a window there with `openWindowFrom(options, { from: { windowId, ...event }, landAt: "from" })` ([window choreography](api-window-contract.md#drag-driven-tear-off-and-merge)). While the pointer is off the app's windows the drag image does not slide back when the drag ends, so a torn-off view stays where it was dropped; over them it slides back as usual. `tearOff` needs a `source` and `onTearOff` (`E_INVALID_ARGUMENT`). Use `dragImage: "view"` so the view itself follows the pointer.

```tsx
const windowId = useWindowId();
<DragDropView source={{ data: { 'application/x-panel': 'notes' } }} dragImage="view" tearOff
  onTearOff={landed => openWindowFrom({ id: 'notes', component: 'Notes' }, { from: { windowId, ...landed }, landAt: 'from' })}>
  <NotesPanel />
</DragDropView>
```

### Operations and modifier keys

While the user holds a modifier key, AppKit narrows the source's operations (`NSDraggingInfo.draggingSourceOperationMask`): Control keeps link, otherwise Option keeps copy, otherwise Command keeps move. The destination performs its first accepted operation among those, so a destination accepting `['move', 'copy', 'link']` moves by default, copies with Option and links with Control. `onDragEnter`, `onDragOver` and `onDrop` report the narrowed operations as `allowedOperations` (macOS only). `ignoreModifierKeys` keeps every source operation regardless of the keys held. `sourceOperations` can differ by where the drag ends: `{ withinApp, outsideApp }`, for example moving within the app but only copying to Finder.

## Errors and availability

`getDragDropAvailability()` reports unsupported platforms or a missing native component; `getDragDropAvailability(feature)` also reports whether this platform implements the feature. `onError` receives `SparkError` for unavailable hosts, malformed native events and native operation errors; its default is `console.error`. The component inserts no error copy into the application UI. An unavailable host renders an ordinary View containing the children; remount after repairing the host to retry. Invalid source/options, and features this platform lacks, are programmer errors thrown during rendering and can be handled by a React error boundary. Native event validation errors report through `onError` without invoking the corresponding event callback.

## Testing

In test driver mode a drag view never starts a window server drag: that would follow the real pointer. The drag-drop package registers the `testDrag` driver command instead ([test-driver.md](test-driver.md)). It builds the source's real dragging items, puts them on a private pasteboard, and delivers the destination calls AppKit makes, with the modifier narrowing above and spring loading after the system's spring-loading delay. The pointer starts at the source's center and moves to each destination's center; `{ phase: "move", by: { x, y } }` moves it that many points (y downward) over no destination, as off the app's windows, and the source hears where the drag ended, so a `tearOff` source dropped there tears off (the `dragOut` flow command). Off the windows means outside every window the driver shows. `dropInFolder` writes promised files into a folder as Finder does; it accepts only an existing folder inside a temporary directory. On the driver backend, `dragAndDrop` from a Spark drag source uses it (`holdAt` holds the drag over `to`), and `dragToFinder` drops into a private temporary folder that the runner creates and removes. Drags between views that are not Spark drag sources keep using pointer input.

The window server itself (real pointer drags, how drag images look, Finder accepting a promise, its spring-loading timing and force click) needs the black-box backend (#118, #119). `tests/drag-drop-native.test.ts` covers the native pieces (masks, items, images, promised writes, sessions), and `tests/drag-drop.test.ts` and `tests/drag-drop-component.test.ts` cover the contracts and the mounted component. Windows compilation of the base view remains unverified in this repository.
