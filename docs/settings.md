# Settings

`@legendapp/spark/settings` exports the default project-scoped JSON `settings` store and `createSettingsStore({ storage })`. Storage adapters implement asynchronous `read(key)`, `write(key, text)` and `remove(key)`. Missing reads return `undefined`; stored JSON `null` remains null. Reads never repair corrupt data implicitly. `get(key, { decode })` is the typed read: the decoder validates persisted data before returning its application type.

Sets snapshot finite JSON values before queuing. Operations serialize per key within one store; this is not cross-store or cross-process locking. An update callback must not await another operation on the same key in the same store.

## Observable files

`@legendapp/spark/settings/observable` explicitly integrates Legend State. Its observable types and React bindings remain owned by Legend State. General IO uses `@legendapp/spark/files`; the separate synchronous native storage API and `/settings/paths` are removed.

```ts
import { createObservableFile } from '@legendapp/spark/settings/observable';
import { getDirectory, mkdir } from '@legendapp/spark/files';

const directory = `${await getDirectory('data')}/preferences`;
await mkdir(directory);
const preferences = await createObservableFile({
  path: `${directory}/count.json`, // Full absolute path, including extension.
  initialValue: 0,
  decode(value) {
    if (typeof value !== 'number') throw new Error('Expected a number');
    return value;
  },
  debounceMs: 300,
});
preferences.value$.set(1);
await preferences.flush();
await preferences.close();
```

The factory resolves only after loading and decoding. Missing files use a copied initial value; corruption, read failures or decoder failures reject before observing any changes. `saveDefault: true` writes a missing file before the factory resolves. Parent directories must already exist. Storage adapters use the same `SettingsStorage` interface with the complete path as key. Paths are not persistence table names; extensions are never appended.

`encode` optionally converts a snapshot before writing, and may be asynchronous. Serialization preserves Legend State Date/Map/Set conventions. Root `undefined` removes a file; `null` writes JSON null. This integration follows Legend State serialization rather than the basic store's finite-JSON-only contract. Do not mutate values returned by `peek()` directly; use Legend State mutations so subscriptions run.

`flush()` snapshots the current observable synchronously, including changes within a batch, and resolves after that snapshot is saved behind earlier writes. Later mutations need their own automatic save or flush. Flushing does not disable future debouncing. Automatic errors appear in `error$`; explicit flush/close also reject. A subsequent successful save clears the error. Failures remain retryable, but there is no automatic retry loop.

`close()` stops observing immediately and flushes one final snapshot. Concurrent closes share completion, and failed closes retry that snapshot. Later observable mutations remain valid Legend State operations but are not persisted. Flush after closing rejects. Await close before quitting. Multiple handles to one path can overwrite one another; a handle only orders its own writes.

`createObservableSettings({ path, fields, ...options })` supplies field defaults and required decoders. Defaults apply only to absent fields; present null values reach the decoder. Unknown fields are omitted. The result has the same handle shape; use `value$.field` with Legend State's `useValue` instead of another Spark get/set/hook facade.

The local persistence controller subscribes directly to Legend State because its flush contract includes changes made in the current batch. Handing writes to a deferred sync-plugin queue would leave flush unable to acknowledge those changes reliably. It does not implement remote synchronization, metadata or retry policy; use Legend State's sync facilities directly for those capabilities.
