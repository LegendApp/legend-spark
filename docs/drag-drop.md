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

`onDragEnter` and `onDrop` receive `DropEvent`. `onDragOver` receives just `{ x, y, operation }`; coordinates use logical units from the destination's top-left corner, positive downward. `onDragLeave` has no payload. `onDragEnd` distinguishes `{ accepted: true, operation: 'copy' | 'move' | 'link' }` from `{ accepted: false, operation: 'none' }`. Acceptance reports native negotiation, not successful application persistence; a move requires the application to coordinate source deletion safely.

`getDragDropAvailability()` reports unsupported platforms or a missing native component. `onError` receives `SparkError` for unavailable hosts, malformed native events and native operation errors; its default is `console.error`. The component inserts no error copy into the application UI. An unavailable host renders an ordinary View containing the children; remount after repairing the host to retry. Invalid source/options are programmer errors thrown during rendering and can be handled by a React error boundary. Native event validation errors report through `onError` without invoking the corresponding event callback.

The competing `/drag-drop/views`, raw native exports, and track-specific source have been removed. Contract and mounted React tests cover payload validation, availability, preserved children, errors, callback updates and unmount behavior. Interactive native dragging and Windows compilation remain pending for this API change.
