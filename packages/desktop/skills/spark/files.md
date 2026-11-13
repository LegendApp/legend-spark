# Files, dialogs and drag and drop

Exports: `@legendapp/spark/files`, `/dialogs`, `/drag-drop`.

## Where data goes

- Use `getDirectory('data' | 'cache' | 'temp')` for app-owned storage. On macOS `data` is under `~/Library/Application Support/<bundle id>/Spark`; Spark's settings and SQLite use the same place. Do not write app data to `~/Documents` or next to the app bundle.
- Third-party storage libraries Spark patches (MMKV, Nitro SQLite, Release Profiler) are also moved to the app's Application Support or Caches folder; see [library-compat.md](library-compat.md).

## Files (`/files`)

- All IO is async. Paths are absolute native paths; local `file://` URLs are accepted and decoded once. Don't hand-encode spaces or `%`.
- Binary IO uses `Uint8Array` (`readBytes`/`writeBytes`), never base64. Use `readChunks`/`writeChunks`/`openFile` for large files.
- Whole-file writes are atomic. `writeTextIfUnchanged(path, previous, next)` returns `{ written: false }` on conflict.
- `remove` is non-recursive by default and succeeds when the path is absent; `mkdir` is recursive by default. `copy`/`move` reject an existing destination unless `{ overwrite: true }`. Prefer `trash` for user-visible deletes.
- `watch` notifications mean "re-read"; they are not an exact change log. Remove watches when done.
- `scanFiles` (macOS) enumerates large trees in batches with `AbortSignal` support.

```ts
import { getDirectory, list, mkdir, readText, writeText } from '@legendapp/spark/files';

const directory = `${await getDirectory('data')}/notes`;
await mkdir(directory);
await writeText(`${directory}/first.md`, '# Hello');
for (const entry of await list(directory)) console.log(entry.name, await readText(entry.path));
```

## Dialogs (`/dialogs`)

- `openFileDialog` / `saveFileDialog` return `{ canceled: true }` or the paths; always check `canceled`. Filters are extensions without dots. Omit filter `name` on macOS (names reject there); nonempty filters reject for directory-only selection. `macos` dialog options reject on other targets.
- A direct `expo-document-picker` import (declared in the app) also works on macOS: Spark redirects `getDocumentAsync` to this open panel and copies picks into the app's Caches unless `copyToCacheDirectory: false`. Unsupported MIME filters and options reject.
- Pass `windowId` to attach as a sheet to that window; omit it for an app-modal dialog.
- `showMessage` returns the chosen button ID (`null` on dismissal); `confirm` and `showPrompt` cover the common cases. `showAboutPanel` shows the standard About panel.

```ts
import { openFileDialog } from '@legendapp/spark/dialogs';
import { readText } from '@legendapp/spark/files';

const result = await openFileDialog({ windowId: 'main', filters: [{ name: 'Markdown', extensions: ['md'] }] });
if (!result.canceled) console.log(await readText(result.paths[0]!));
```

## Drag and drop (`/drag-drop`)

One `DragDropView` is both source and destination. Built-in payloads: `files` (absolute paths), `text`, `urls`; custom data uses lowercase MIME names you opt into with `acceptedTypes`. Source-enabled views own the mouse gesture, so use a dedicated drag handle instead of wrapping interactive controls. A drop's `accepted: true` is OS negotiation, not proof your app persisted anything; a `move` means you delete the source yourself. File promises are not implemented.

```tsx
import { DragDropView } from '@legendapp/spark/drag-drop';
import { Text } from 'react-native';

declare function importFiles(paths: string[]): void;

export const DropZone = () => (
  <DragDropView onDrop={({ files }) => files && importFiles([...files])} onError={console.error}>
    <Text>Drop files here</Text>
  </DragDropView>
);
```

## Platforms

macOS: all. Windows (dev builds): files, dialogs and drag-drop have backends; `scanFiles` and dialog accessory controls are macOS-only; Windows recursive watches need an existing directory. Mobile/web: not covered; use Expo FileSystem / DocumentPicker there.
