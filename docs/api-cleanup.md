# API cleanup implementation

Approved scope: [shared contracts and all API families](api-contracts.md), including the [window contract](api-window-contract.md). React Native is assumed; no legacy/deprecated forwarding exports are required. Expo compatibility applies to explicitly selected methods; SQLite and WebView require Spark-owned contracts.

Base: `5e17417` on `jmeistrich/fix-api-defects`. Local stack starts at `jmeistrich/api-contracts`. Remote main has unrelated divergence; no history rewrite or push is part of this work.

## Completion criteria

- [ ] Shared errors, native-response validation and lifecycle contracts used by feature APIs.
- [ ] App/documents/windows consolidated, with explicit identities, typed events and preserved desktop capabilities.
- [ ] Menus, shortcuts, context/tray/Dock share contracts.
- [ ] Files/dialogs/settings and remaining system APIs normalized; duplicate public exports removed with their callers.
- [ ] SQLite, WebView and audio expose owned contracts, with adapter/lifecycle coverage.
- [ ] UI, drag/drop and configuration/tooling contracts aligned.
- [ ] Public export inventory reconciled, TypeScript and relevant tests pass; native checks recorded with actual target coverage.

This is an implementation checklist, not a claim that the whole approved design has landed. Unit checks with mocked native boundaries do not establish native platform parity.

## Verified units

- Shared native-free contracts: 8 focused tests and full TypeScript check passed.
- SQLite: public backend objects replaced by Spark query/transaction/close types; kitchen-sink callers updated. Real in-memory SQLite tests cover parameters/blobs, commit/rollback, transaction lifetime, close ordering and unsafe values. Native OP-SQLite execution still requires target validation.
- WebView: owned component/source/ref/event types replace upstream reexports; kitchen-sink uses plain Spark event payloads. Adapter tests cover source/event translation, unknown backend props and stale refs. Native navigation/message execution remains to be validated.

- Dialogs: one `/dialogs` export; explicit open/save cancellation and stable message button IDs. File IO moved to `/files` (`writeTextIfUnchanged` and `revealInFileManager` included); old names and `/message-dialog` removed with repository callers. Missing modules import safely, unsupported hosts reject, malformed output rejects. File filters are extension-only and combined; mixed selection is a macOS option. Open/save owner-window targeting is not yet implemented; unknown options reject. The following file-IO unit moves reveal/conditional writes into the filesystem native module, removing its dialog dependency. Conditional writes detect observed edits, not an OS-wide atomic compare-and-swap. Full TypeScript and 85 focused/API/codegen tests pass. Native UI validation is pending.

- File IO: `readBytes`/`writeBytes`, `FileInfo`, named/path directory entries and void/idempotent removal replace old transport/results. Local file URLs normalize to native paths; result shapes, numeric bounds and binary responses are checked. Watch removal/file close join concurrent cleanup and can retry failures. The native file module now owns conditional write/reveal and the old dialog native methods are deleted. macOS deletion distinguishes permissions from absence and removes dangling links. Full TypeScript and 89 focused/API/codegen/native-mutation tests pass; the Foundation test executes the actual macOS conditional-write/removal implementation. Full RN host integration and Windows native compilation remain pending. Scanner and specialized watcher consolidation is the next file unit.

- Scanning/watching: `scanFiles` and owned types are exported with `/files`; `/files/scanner`, `/files/watchers`, the raw scanner emitter and the singleton watcher module are removed. Native scan IDs correlate concurrent calls; per-call callbacks and cooperative AbortSignal cancellation clean up before completion. Document reload uses the ordinary invalidation watcher, reports errors and disposes late registrations. Full TypeScript and 80 focused/API/codegen/scanner tests pass. Scanner core runs against real files in a Foundation test; native RN event transport still needs host validation.

- Expo subsets: remove clipboard text aliases and the `secureStorage` facade; the unused synchronous service-keychain API and its native entry are deleted. Shared Clipboard types are owned by Spark on desktop and Expo adapters. Rich PNG content uses bytes; write inputs distinguish file lists from text/images while reads preserve coexisting OS representations. Secure storage and clipboard import without native modules and validate added options/native output. Full TypeScript and 86 focused API/codegen/availability tests pass. Native Keychain/clipboard execution and mobile device acceptance remain pending.

- Settings store: explicit `{ storage }` factory, named interfaces, missing=`undefined` vs stored `null`, and decoder-backed typed reads. Invalid JSON values (including Date/Map/Set coercion and sparse arrays) reject; queued sets snapshot input. Per-key serialization recovers after errors and remains local to each store. TypeScript and ten settings tests pass. Observable persistence and raw storage consolidation follow in a separate unit.

- Observable settings: awaited loading with required decoding, one `value$`/`error$`/`flush`/`close` handle, snapshot writes and retryable cleanup. The shared async file backend replaces synchronous native storage and `/settings/paths`; generic raw storage helpers are deleted in favor of `/files`. Field defaults distinguish absent and null; Legend State owns observable/React APIs. Full TypeScript and 105 focused API/settings/codegen/metadata tests pass, including corruption, batching, debounce, async encoding, failure and lifecycle coverage. Native file transport retains its separate host-validation requirement.
