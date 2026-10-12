# Sharing, Services and Spotlight

`@legendapp/spark/sharing` shows the macOS share picker, receives text and files that other apps send through
their Services menu, and puts the app's content in Spotlight.

```ts
import { addServiceListener, addSpotlightListener, deleteSpotlightItems, indexSpotlightItems, share } from '@legendapp/spark/sharing';

const { service } = await share([{ type: 'text', text: 'Pancakes' }, { type: 'file', path: '/Users/me/pancakes.pdf' }], { anchor: shareButtonRef.current });

const registration = await addServiceListener('Make Recipe', ({ text, files }) => importRecipe(text, files));
await registration.remove();

await indexSpotlightItems([{ id: 'recipe-12', title: 'Pancakes', domain: 'recipes', keywords: ['breakfast'] }]);
const opened = addSpotlightListener(({ id }) => openRecipe(id));
await deleteSpotlightItems({ domains: ['recipes'] });
```

`getSharingAvailability(feature)` reports `share`, `services` and `spotlight` separately. App Intents and Shortcuts
are not provided: the system only knows intents compiled into the app's App Intents metadata, which Spark's build
cannot produce today (#393). The Quick Look panel is `showQuickLook` in [`@legendapp/spark/files`](files.md); the
default URL handler and universal links are in [`@legendapp/spark/links`](links-and-documents.md#default-url-handler).

## Share

`share(items, { anchor? })` shows `NSSharingServicePicker` for the items: `{ type: 'text', text }`,
`{ type: 'url', url }` (a web URL, not a file URL) or `{ type: 'file', path }` (an absolute path or file URL of an
existing file, else `E_NOT_FOUND`). The picker points at `anchor`, a mounted view ref (`E_NOT_FOUND` when it is
not in a window; a flattened View needs `collapsable={false}`), or at the key window's content; without a visible
window it rejects `E_UNAVAILABLE`.

It resolves once the person picks a service, with `{ service }`: the service's title as macOS shows it ("Mail",
"Messages", "AirDrop"), localized; or `{ service: null }` when they dismiss the picker. The chosen service then
finishes on its own (a Mail draft, a conversation); macOS does not report its outcome for every service, so
`share` does not wait for it. One picker at a time: another `share` meanwhile rejects `E_BUSY`.

Expo Sharing's `shareAsync` shares one local file and React Native's `Share` resolves after the share completes;
neither describes this operation, so Spark does not borrow their names.

## Services

Another app's Services menu sends the selection to a service the app declares in its Info.plist. Declare each
service as an `NSServices` entry whose `NSMessage` is `sparkService` and whose `NSUserData` is the name you pass to
`addServiceListener`:

```json
"macos": { "infoPlist": { "NSServices": [{
  "NSMenuItem": { "default": "Make Recipe" },
  "NSMessage": "sparkService",
  "NSUserData": "Make Recipe",
  "NSSendTypes": ["public.utf8-plain-text", "public.file-url"]
}] } }
```

`addServiceListener(name, listener, { onError? })` resolves once the app is the Services provider for `name`. The
listener receives `{ name, text, files, urls }`: the plain text (null without any), file paths and web URLs from the
pasteboard. A name without a declaration rejects `E_UNAVAILABLE`; one listener per name (`E_BUSY`). Services that
return data (`NSReturnTypes`, such as "make uppercase") reject `E_UNSUPPORTED_OPTION`: AppKit needs their result
before the provider method returns, and Spark never blocks the main thread on asynchronous JavaScript.
`remove()` stops delivery and releases the name; a JavaScript reload releases the runtime's names.

macOS adds declared services to the Services menu when it registers the app (at install or first launch);
during development `/System/Library/CoreServices/pbs -update` refreshes the list. Spark never calls
`NSUpdateDynamicServices`.

## Spotlight

`indexSpotlightItems(items)` adds items to the app's Core Spotlight index (`CSSearchableIndex.defaultSearchableIndex`),
replacing items with the same `id`, and resolves once the index has them. Each item has an `id` and `title`, and
optional `domain`, `description`, `keywords` and `expiresAt` (Unix ms; Core Spotlight drops items 30 days after
indexing unless given one). `deleteSpotlightItems({ ids } | { domains } | { all: true })` removes them; ids that are
not indexed are not an error. Both reject `E_UNAVAILABLE` when indexing is not available on the Mac
(`CSSearchableIndex.isIndexingAvailable`), and `E_NATIVE` with Core Spotlight's message when it fails. Completion
handlers run on arbitrary queues; each call settles once, on the main thread.

When the person opens one of the items, the host app delegate receives `CSSearchableItemActionType` and
`addSpotlightListener(listener, { onError? })` gets `{ id }`. An opening before the first listener of the process (the
one that launched the app) is held, up to 20, and delivered once to that listener after it is added.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) the module is simulated in the app's
memory: no picker appears, the Services provider is never set, the Spotlight index is never written, and nothing
reaches pbs. Share items, anchors and Spotlight items are validated as in a real run. Two driver commands, built only
with the driver:

- `{"command": "simulateSharing", "shareAnswer"?, "services"?, "invokeService"?, "openSpotlightItem"?, "openUniversalLink"?}`.
  `shareAnswer` is what the simulated picker answers: a service title, or `"dismiss"`; `null` (the initial state)
  makes `share` reject `E_UNAVAILABLE`. `services` replaces the declared service names (the simulation never reads
  Info.plist, so the Kitchen Sink declares none and never appears in the Services menu). `invokeService: { name, text }`
  runs a registered service as the Services menu would, with the text on a private pasteboard. `openSpotlightItem: id`
  and `openUniversalLink: url` deliver an `NSUserActivity` to the app delegate as macOS does.
- `{"command": "testSharing"}` replies `sharing`: `shares` (each `{ items, anchored, service }`, also the rejected
  ones), `indexed` (id to item), `services` (declared), `registered` (with a listener), `invocations` and `answer`.

Flows use them as `simulateSharing` and `assertSharing` ([e2e-flow-commands.md](e2e-flow-commands.md)). The real
picker, Spotlight results and default URL handler are checked only by the manual flow
`e2e/flows/system-integration/sharing-real.yaml`, which the gate never runs. The Kitchen Sink declares no Services, so
the real provider path is covered by `tests/sharing.native.mm`, which runs it in-process on a private pasteboard.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available. |
| Windows | `getSharingAvailability(feature)` reports `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Tracked in #392. |

The Kitchen Sink's Sharing & Spotlight screen (`spark-ks://system-integration/sharing`) shares text, a link and a
file, listens for a service, indexes and deletes sample recipes, logs Spotlight openings and universal links, and
sets the default handler for `spark-ks`; its flows are in `e2e/flows/system-integration/`.
