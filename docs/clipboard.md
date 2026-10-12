# Clipboard

`@legendapp/spark/clipboard` keeps Expo's text subset (`getStringAsync`, `setStringAsync`, `hasStringAsync`,
`StringFormat`) on every platform and adds desktop extensions: rich reads and writes, promised (lazy) data, change
monitoring, and concealed/transient markers.

| Function | macOS | Windows | iOS, Android, web |
|---|---|---|---|
| `getStringAsync`, `setStringAsync`, `hasStringAsync` | yes | yes | Expo Clipboard |
| `readClipboard`, `writeClipboard`, `getClipboardFormats`, `clearClipboard` | yes | yes | `E_UNSUPPORTED_PLATFORM` |
| `writeClipboard(content, { concealed, transient })` | yes | `E_UNSUPPORTED_PLATFORM` ([#359](https://github.com/LegendApp/legend-spark/issues/359)) | `E_UNSUPPORTED_PLATFORM` |
| `writePromisedClipboard` | yes | `E_UNSUPPORTED_PLATFORM` (#359) | `E_UNSUPPORTED_PLATFORM` |
| `onClipboardChange`, `getClipboardChangeCount` | yes | `E_UNSUPPORTED_PLATFORM` (#359) | `E_UNSUPPORTED_PLATFORM` |

`getRichClipboardAvailability()` reports the rich clipboard module; `getRichClipboardAvailability(feature)` reports
`"promisedData"`, `"changeEvents"` or `"privacyMarkers"`. Both are synchronous and never load the native module. An
unknown feature throws `E_INVALID_ARGUMENT`.

## Concealed and transient data

```ts
await writeClipboard({ text: password }, { concealed: true });
await writeClipboard({ text: draft }, { transient: true });
```

The options add the [nspasteboard.org](http://nspasteboard.org) markers `org.nspasteboard.ConcealedType` and
`org.nspasteboard.TransientType` to the first pasteboard item, beside the data. Clipboard managers do not record or
show concealed data (passwords) and ignore transient data. They are conventions: other apps can still paste the data.
`getClipboardFormats()` lists the markers when they are present. Unknown options reject `E_UNSUPPORTED_OPTION`;
non-boolean values reject `E_INVALID_ARGUMENT`. `writePromisedClipboard` takes the same two options.

## Promised data

```ts
await writePromisedClipboard({
  types: ["text", "html", "png"],
  provide: async type => type === "png" ? await renderPng() : type === "html" ? toHtml(doc) : toText(doc),
}, { timeoutMs: 2000, onError: error => log(error.code) });
```

The clipboard is replaced at once, but no representation is produced until something pastes it, in this app or another.
`provide(type)` runs at most once per type, when it is asked for, and returns a string (`text`, `html`, `rtf`) or PNG
bytes as a `Uint8Array` (`png`). Use it for data that is expensive to produce or large (an image of a whole document).

- **Waiting.** AppKit asks for promised data on the main thread and the pasting app waits for the answer, so the app's
  main thread waits for `provide` too, up to `timeoutMs` (1–30000 ms, default 5000). After that the paste gets nothing
  for that type. Keep `provide` fast, and do not call other Spark APIs that need the main thread from inside it.
- **Errors.** `onError` receives `E_UNAVAILABLE` when `provide` throws (with the thrown error as `cause`),
  `E_INVALID_DATA` when it returns the wrong kind of data or a PNG AppKit cannot decode, and `E_TIMEOUT` when its
  answer arrives after the paste stopped waiting. In each case the paste gets nothing; a throwing `provide` answers at
  once instead of waiting for the timeout. Without `onError`, the error is rethrown asynchronously.
- **Lifetime.** The provider is held until every type has been provided or the clipboard is replaced (by any app), then
  released. Promised data that was never pasted is lost when the app quits or reloads its JavaScript; after a reload,
  a paste of it gets nothing at once.
- **Validation.** `types` must be a nonempty list of distinct `text`, `html`, `rtf` and `png`; anything else rejects
  `E_INVALID_ARGUMENT` before the clipboard changes.

File promises (`NSFilePromiseProvider`) belong to drag and drop and are not part of the clipboard API.

## Change monitoring

```ts
const start = await getClipboardChangeCount();
const registration = await onClipboardChange(({ changeCount }) => refreshPasteButton(), { intervalMs: 500 });
// later
await registration.remove();
```

`onClipboardChange` calls the handler after the clipboard changes, by this app or another. macOS has no clipboard
change notification, so the module polls the pasteboard's change count: one timer for every registration, at the
shortest `intervalMs` among them (100–10000 ms, default 500), with 10% timer tolerance so the system can coalesce
wakeups. Reading the change count reads no clipboard contents. The timer exists only while a registration does;
`remove()` is idempotent, and concurrent calls share one cleanup. Several changes between two polls arrive as one
event with the latest `changeCount`. Contents present when watching starts are not a change: read
`getClipboardChangeCount()` for the starting point. Events carry no contents; read what you need when one arrives.

## Testing

The native module takes the pasteboard it works on as a parameter (`SparkClipboard initWithPasteboard:` in
`packages/clipboard/macos/SparkClipboard.h`); nothing below the module looks up the general pasteboard. The module
passes `NSPasteboard.generalPasteboard`, except in test driver mode
([test-driver.md](test-driver.md)): when the driver starts, before any JavaScript runs, the module switches to a
private pasteboard (`pasteboardWithUniqueName`) and releases it when the app quits. Driver flows and `ks:capture`
therefore never read, replace or clear the user's clipboard, and a flow's clipboard starts empty on every launch.

The clipboard package registers two driver commands for that pasteboard. `setTestClipboard` (`text`, `html`,
`concealed`) writes it as another app would; `testClipboard` reads its types, plain text and change count as another
app's paste would, which makes the app provide promised text. The flow commands `setClipboard` and `assertClipboard`
use them on the driver backend: `assertClipboard` passes when every listed type is present and the plain text equals
`text`.

`tests/clipboard-native.test.ts` compiles `SparkClipboard.mm` into a harness that drives it against its own
`pasteboardWithUniqueName` pasteboard and checks that the general pasteboard's change count never moved.
`tests/clipboard.test.ts` covers the JavaScript contract over a recording native module. The Kitchen Sink screen is
`spark-ks://clipboard/data`, with checks `CLIP-*` in `e2e/checks/clipboard.yaml` and flows in `e2e/flows/clipboard/`.
