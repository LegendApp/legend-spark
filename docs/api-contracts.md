# Spark API cleanup proposal

Status: approved design; implementation complete, native acceptance remains partial. See [the final review](api-final-review.md). September 27, 2026. Source baseline: `5e17417`. Covers the complete 63-entry public API surface audited before implementation. The [window detail](./api-window-contract.md) is one supporting appendix, not the scope of this proposal.

## Product constraints and recommendation

Spark is a React Native framework. Feature APIs should include their components, hooks, types, and imperative operations together. There is no requirement for a separate non-React API. OS support differences still need clear behavior; they do not justify `/react` import paths or a generic multi-framework architecture.

There are no external users. Make breaking changes directly, update repository consumers/examples/tests/docs together, and delete superseded APIs. No deprecated aliases, compatibility layers, or migration period. Preserve useful functionality, not historical API shapes. This design does not add new target platforms or change the project's existing target support.

**Recommendation: use Expo as the first design reference, own Spark's capability contracts, and keep large ecosystem abstractions upstream-owned.** A replaceable backend and an Expo-shaped API are compatible choices. Matching a good existing API avoids inventing new vocabulary; implementing it through an adapter lets Spark choose the backend.

All signatures below are design sketches. Named but unexpanded types indicate contracts to specify during implementation; snippets are not complete declaration files. Proposed options are not claims of current backend support.

## 1. How closely should Spark match Expo?

### Match semantics before spelling

Adopt an established Expo contract when it describes the same operation and its behavior is suitable. Match the supported method's argument meanings, defaults, return values, lifecycle, and cancellation—not just its name. State the supported subset and platform differences. Never claim compatibility with a whole Expo package when only three methods are implemented.

This is already the useful direction in Spark's [external-library policy](external-libraries.md) and [small Expo adapters](expo-api-adapters.md). This proposal revises that policy's passthrough recommendation for WebView and SQLite because substitutable implementations are now an explicit design objective. It also removes the old policy's pre-user compatibility/migration requirements. Repository policy documents should be updated with implementation, not left contradicting the chosen API.

### There is no single Expo naming pattern to copy mechanically

In Spark's pinned SDK 54 reference, Clipboard uses `getStringAsync`/`setStringAsync`, while Audio exposes `useAudioPlayer` and a player object, and FileSystem exposes `File`, `Directory`, synchronous operations, and asynchronous `text()`. Consistency cannot mean adding `Async` everywhere or making every capability object-oriented. Sources: [Clipboard](https://docs.expo.dev/versions/v54.0.0/sdk/clipboard/), [Audio](https://docs.expo.dev/versions/v54.0.0/sdk/audio/), [FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/).

Recommended precedence:

1. React Native expectations for components, props, hooks, and references.
2. An exact, deliberately selected Expo contract for an equivalent capability.
3. Spark's own consistent design when Expo has no equivalent or the semantics differ materially.

Preserve names and results in adopted subsets, even when they differ from Spark defaults. For example, `Clipboard.setStringAsync` returns a boolean; do not change it to `void` while claiming that method is Expo-compatible. New Spark-owned commands normally return `void`. [Expo Clipboard return contract](https://docs.expo.dev/versions/v54.0.0/sdk/clipboard/#setstringasynctext-options)

Use the SDK version Spark actually supports as the conformance baseline, rather than silently chasing latest documentation. This proposal does not authorize an Expo upgrade. Future upstream changes are reviewed, not automatically exported.

| Area | Recommended relationship to Expo |
|---|---|
| Clipboard, secure storage, URL linking | Keep the existing named Expo subsets; normalize duplicate Spark aliases away. Add explicit Spark extensions for richer desktop behavior. |
| Audio | Keep familiar player/hook concepts, but own Spark's async loading and command contract. Existing Spark creation returns a promise; adopting an Expo name alone does not make its lifecycle equivalent. |
| Files | Keep an explicit path-based async Spark API and positional file handles for now. Do not copy Expo's whole File/Directory object model just for resemblance. |
| Notifications | Borrow content/trigger separation and permission vocabulary. Do not imply Expo push-token, background-task, or complete notification compatibility. |
| Auth | Keep Spark's prepared-session/state/redirect flow. Do not claim full expo-auth-session compatibility. |
| Windows, desktop menus, tray, processes, Dock | Spark owns these contracts. Expo need not constrain them. |
| UI | React Native props and lifecycle first. Use Expo UI as an implementation where it fits, without exposing its backend-specific component model through shared Spark controls. |
| SQLite | Borrow understandable query/transaction naming; the proposed small database contract is Spark-owned, not an implementation of all expo-sqlite. |
| Native application updates | Spark contract; do not imitate Expo Updates in a way that implies JavaScript OTA updates. |

For Expo-aligned methods, preserve upstream error/result behavior where promised; document Spark-specific availability or unsupported-option failures separately. The common Spark error model is for Spark-owned operations and adapters' added failures, not a promise to rewrite every upstream exception.

## 2. External dependencies: which APIs should Spark own?

### Three explicit ownership categories

| Category | Consumer import and contract | Consequence |
|---|---|---|
| Spark capability | `@legendapp/spark/<feature>`; Spark owns public types and behavior | Backend can change if it passes the same contract tests. This includes an Expo-shaped subset when deliberately adopted. |
| Ecosystem integration | Original package; upstream owns the API | Spark handles installation, native integration, tested versions, and build support. Replacing the library may require application changes. |
| Application-specific functionality | Application code or a domain package | Do not turn one app's data model into a Spark framework contract. |

A passthrough such as `export { WebView } from 'react-native-webview'` only stabilizes the import string. `export type { WebViewProps }` and returning an OP-SQLite `DB` still commit consumers to that dependency's complete exposed shape. A future swap must implement those shapes or break consumers. That is not meaningful implementation independence.

### Recommended ownership decisions

| Capability or dependency | Decision |
|---|---|
| Clipboard, secure storage, linking | Spark owns explicitly selected Expo-shaped methods and its extensions. |
| Audio and media session | Spark owns player/status/session types and lifecycle. Backend objects remain internal. |
| Files, settings, dialogs, notifications, auth | Spark owns the capability and its semantics. |
| SQLite | Spark owns a small query/transaction/close contract and project storage placement. Stop returning an OP-SQLite DB. See the concrete contract below. |
| WebView | Spark owns a supported component/ref/event subset if it keeps `/webview`. Replace the passthrough with a real boundary. Do not clone every upstream prop. |
| UI controls and desktop components | Spark owns props/ref/event contracts. Implementations may use RN, Expo UI, or native components. |
| Legend State | Keep its Observable model upstream-owned. `/settings/observable` is explicitly a Legend State integration; do not pretend it is state-library-independent. |
| Runtimes, Nitro, routing, React Native, animation/gesture engines | Use upstream APIs directly. Their execution/object models are too central to hide behind a cheap adapter. Native support alone does not justify a Spark wrapper. |
| `clsx`/Tailwind merge and Uniwind | Keep small explicit utility/styling integrations; document the library-specific semantics. These are not a universal styling contract. |
| Music track drag/drop payloads | Move to the application/domain layer; Spark handles generic custom drag payloads. |

### What replacement actually costs

An owned contract must cover more than TypeScript signatures: loading, disposal, callback ordering, cancellation, numeric conversions, permissions, resource limits, threading and platform support. Backend replacement is accepted only after behavior and relevant performance tests pass. Some differences cannot be hidden; treat those as a deliberate future API change rather than pretending every backend is interchangeable.

Do not build a runtime backend registry or ship multiple backends merely to prove abstraction. Use one internal adapter per capability, plus existing target-specific implementations. Test adapters against the same observable contract. Use a second implementation only when evaluating a real replacement.

Do not expose `native`, `backend`, arbitrary `backendOptions`, upstream `Pick`/`Omit` types, or a raw DB/player as escape hatches inside a supposedly independent API. Own the public declarations. If an application needs specialized upstream functionality, it imports that package directly and knowingly accepts that dependency. Do not mix direct and Spark-owned access to the same live resource without a defined ownership boundary.

## 3. Shared API conventions

- **Imports:** one public feature boundary; hooks and imperative operations together. Subpaths are justified by a separate capability or explicit optional integration, not implementation layers. Avoid eager imports of every optional native/UI backend when consolidating exports.
- **Arguments:** clear required subjects plus final options: `copy(source, destination, options?)`. Related configuration belongs in one object: `openWindow(options)`. Keep `quit()` simple. No placeholder option bags or new unsupported behavior merely for theoretical extensibility.
- **Options:** reject unknown keys with `E_UNSUPPORTED_OPTION`, even when the unknown key's value is `undefined`. Known optional keys may still use `undefined` as omission.
- **Types:** named public Options/Result/Event/Handle types; discriminated unions for alternatives; runtime validation at untrusted native/JSON boundaries. Generic result type parameters are assertions unless validated by a supplied decoder.
- **Results:** Spark commands resolve `void`; useful data has explicit types. Cancellation/close veto/nonzero child exit are expected results. Operational failures reject. No fabricated empty files, successful no-ops, or malformed-response-as-cancellation. Explicit Expo subsets keep their selected result contracts.
- **Errors:** start with codes for invalid arguments/data, unsupported platform/option, missing module, permission denied, not found, already exists, busy, closed, aborted, timeout, and native failure. Preserve `cause`. Promise APIs reject validation errors consistently; synchronous utilities throw. Codes—not parsed messages—drive application logic.
- **Availability:** feature-local, safe without loading a missing native module, separate from permissions. An affirmative query is advisory; operations may still fail. Do not make every call require a preflight query. `get<Feature>Availability(): Availability` is synchronous whenever the answer is known locally (platform, module presence, host restriction); it returns a promise only when answering needs I/O, and an adopted Expo subset keeps `isAvailableAsync()` instead. Status-embedded availability is a separate richer query, not a substitute.
- **Events:** typed payloads; define initial snapshot/replay separately from live events. No public raw bridge dispatcher or arbitrary event bag.
- **Lifecycle:** synchronous subscriptions return `{ remove(): void }`; async registrations return a promise of `{ remove(): Promise<void> }`. Readiness and failure are explicit; cleanup is idempotent and concurrent removals share completion. Failed cleanup remains retryable where safe. Hooks dispose late-completing registrations and read current handlers.
- **Cancellation:** `AbortSignal` where underlying work can honor it; specify partial output and whether native work stops. Files retain `close()`, processes `terminate()`, sessions `dismiss()` where meaning differs from removing a listener.
- **Units/data:** `timeoutMs`, `delaySeconds`, Unix timestamp milliseconds, audio seconds. Distinguish native paths, URIs, and bytes/base64. Normal binary IO uses `Uint8Array`; serialization is internal unless a format explicitly requires it.
- **Updates:** omission means unchanged, `null` clears only declared nullable fields, arrays replace, documented object groups merge by supplied fields. Declare immutable fields. Validate the full request before side effects; do not promise native transactionality where none exists.
- **Platform details:** typed `macos`/`windows` groups where relevant. Inactive-platform groups may be skipped by definition; unsupported requested behavior on the active target rejects. No smallest-common-subset requirement and no implied support for new OS targets.

## 4. Proposed API families

These are the intended ownership boundaries and signature directions for the whole SDK. Existing behavior that does not conflict with the conventions stays; this is not a mandate to rename every function.

### App, documents, and windows

```ts
// /app
getAppContext(): Promise<AppContext>;
activate(): Promise<void>;
hide(): Promise<void>;
quit(): Promise<{ quitRequested: true } | { quitRequested: false; reason: 'vetoed' }>;
beforeQuit(handler: () => boolean | Promise<boolean>): Promise<AsyncRegistration>;
addAppListener(type, listener): Subscription; // Typed event map.

// /app/documents
noteRecentDocument(path: string): Promise<void>;
getRecentDocuments(): Promise<RecentDocument[]>;
clearRecentDocuments(): Promise<void>;
subscribeToOpenRequests(listener): Promise<Subscription>;
```

Process termination cannot acknowledge completed shutdown through a JavaScript promise. Define `quit` success as native acceptance after guards, not proof that the process exited. One coherent quit coordinator replaces request/complete/listen duplicates. App context exposes typed runtime information rather than arbitrary bridge data.

Keep document-controller/reload/transition helpers with document APIs. Typed open requests distinguish file paths from URL activation. Subscribe before draining queued launch requests and deduplicate the overlap; document replay semantics. General path manipulation belongs in files, not document orchestration.

`/windows` includes `openWindow`, state commands, events, guards, `createWindowsNavigator`, `WindowProvider`, and hooks. Use one ID/options/result model with explicit ownership. Keep useful native restoration and toolbar features. The [window appendix](./api-window-contract.md) contains signatures, coordinates and lifecycle decisions. Remove `/windows/react`, `/windows/managed`, and `/windows/controls`; retain internal source separation as useful.

### Menus, context menus, tray, Dock, and shortcuts

Share one menu item language across surfaces, including toolbar popup menus. Surface support is explicit; sharing a type does not require every surface to support every item.

```ts
type MenuItem =
  | { type: 'separator' }
  | { type: 'action'; id: string; label: string; disabled?: boolean; shortcut?: string }
  | { type: 'checkbox'; id: string; label: string; checked: boolean; disabled?: boolean }
  | { type: 'submenu'; id: string; label: string; items: readonly MenuItem[] }
  | { type: 'role'; role: MenuRole; label?: string }
  | { type: 'slider'; id: string; label: string; min: number; max: number; value: number; suffix?: string };

// Feature entrypoints expose only the item shapes their native surface accepts.
type MenuEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean; icon?: MenuIcon; target?: MenuTarget; placement?: MenuPlacement };
type AppMenuItem =
  | { type: 'separator' }
  | (MenuEntry & { type: 'action'; shortcut?: string })
  | (MenuEntry & { type: 'checkbox'; checked: boolean; shortcut?: string })
  | (MenuEntry & { type: 'submenu'; items: readonly AppMenuItem[] })
  | (Omit<MenuEntry, 'label'> & { type: 'role'; role: MenuRole; label?: string; shortcut?: string });
type MenuRootItem = Extract<AppMenuItem, { type: 'submenu' }>;
type ContextMenuEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean };
type ContextMenuItem = { type: 'separator' } | (ContextMenuEntry & { type: 'action' }) | (ContextMenuEntry & { type: 'checkbox'; checked: boolean });
type TrayEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean };
type TrayLeaf = { type: 'separator' } | (TrayEntry & { type: 'action' }) | (TrayEntry & { type: 'checkbox'; checked: boolean });
type TrayMenuItem = TrayLeaf | (TrayEntry & { type: 'submenu'; items: readonly TrayMenuItem[] });
type ToolbarEntry = { id: string; label: string; disabled?: boolean; hidden?: boolean; icon?: { type: 'symbol'; name: string } };
type ToolbarMenuItem =
  | { type: 'separator' }
  | (ToolbarEntry & { type: 'action' })
  | (ToolbarEntry & { type: 'checkbox'; checked: boolean })
  | (ToolbarEntry & { type: 'slider'; min: number; max: number; value: number; suffix?: string });

// /menus: imperative ownership plus useMenu in the same module.
createMenu(options: { id: string; items: readonly MenuRootItem[]; onAction: MenuActionHandler }): Promise<Menu>;
// Menu: update(options), remove(). Semantic roles target native responders.
// Application menus accept recursive action, checkbox, separator, submenu, and role items; sliders are toolbar-only.

// /context-menu
showContextMenu(options: {
  items: readonly ContextMenuItem[];
  windowId: string;
  position: { x: number; y: number }; // Logical units in owner content coordinates.
}): Promise<{ canceled: true } | { canceled: false; itemId: string }>;
// Context menus are flat and omit shortcuts, icons, targets, and placements.

// /tray
createTray(options: TrayOptions): Promise<Tray>; // menu?: readonly TrayMenuItem[]; update + remove.
// Tray menus recurse through submenus and omit shortcuts, icons, targets, and placements.
// macOS toolbar popup menus use ToolbarMenuItem: sliders are supported, but roles, submenus,
// shortcuts, targets, and placements are not.
// The macos presentation group is ignored on Windows.

// /shortcuts; /global-shortcuts
registerShortcut(accelerator, handler, options?): Promise<AsyncRegistration>;
registerGlobalShortcut(accelerator, handler, options?): Promise<AsyncRegistration>;
```

Use portable accelerator strings and one parser. Numeric physical key codes remain an explicitly low-level keyboard API. Preserve local/global distinction, conflict failures, owner/window scope and repeat behavior. Command routing adds named actions and persisted bindings on top of the same shortcut concepts; it is not a second key syntax. Put callbacks into creation options when a resource has multiple callbacks. Use semantic role/ID targeting instead of translated menu-title matching.

Local command registrations publish native matching rules and explicit boolean enablement. Await `setEnabled` and suspension updates for native acknowledgment. Low-level keyboard callbacks observe events; their return values do not control native propagation. Never block the native event loop waiting for JavaScript handlers.

Finalize the shared menu schema with current toolbar needs, including typed sliders and icon inputs, before implementing consolidation. It must not discard existing functionality. No colon-encoded slider values. Tray image inputs distinguish portable assets from macOS symbols.

### Dialogs and files

```ts
// /dialogs
openFileDialog(options?: {
  selection?: 'files' | 'directories';
  multiple?: boolean;
  directory?: string;
  filters?: readonly FileFilter[];
  windowId?: string;
  title?: string;
}): Promise<{ canceled: true } | { canceled: false; paths: string[] }>;
saveFileDialog(options?: SaveFileDialogOptions): Promise<SaveFileDialogResult>;
showMessage(options: MessageDialogOptions): Promise<MessageDialogResult>;
confirm(message: string, options?: ConfirmOptions): Promise<boolean>;

// /files
readText(path, options?): Promise<string>;
writeText(path, text, options?): Promise<void>;
readBytes(path, options?): Promise<Uint8Array>;
writeBytes(path, bytes, options?): Promise<void>;
stat(path): Promise<FileInfo>;
exists(path): Promise<boolean>;
list(path, options?): Promise<DirectoryEntry[]>;
mkdir(path, options?): Promise<void>;
remove(path, options?): Promise<void>;
trash(path): Promise<void>;
copy(source, destination, options?): Promise<void>;
move(source, destination, options?): Promise<void>;
writeTextIfUnchanged(path, expected, contents): Promise<{ written: boolean }>;
openFile(path, options?): Promise<FileHandle>;
readChunks(path, options?): AsyncIterable<Uint8Array>;
writeChunks(path, chunks, options?): Promise<number>;
watch(path, listener, options?): Promise<AsyncRegistration>;
scanFiles(paths, options?): Promise<FileScanResult>;
```

Open/save share directory/filter/owner vocabulary. Prefer stable button IDs in message results. File filters must have defined extension/MIME handling per target. Mixed file/directory selection remains a typed platform extension if required; never silently remove the existing capability.

Preserve conditional write semantics. Define overwrite/symlink behavior, absent-file errors, and missing removal (recommend idempotent absence); distinguish permission errors from nonexistence. Keep efficient chunk IO and positional handles. Use direct native buffers for binary transport; do not encode ordinary byte IO as base64 or JSON. Snapshot mutable input once at submission and return views over freshly owned native output. Watch means invalidation, not a perfect change log. Scanner options carry operation-scoped progress/batch callbacks and a signal; no uncorrelated global scan events. Keep specialized event watching only if its stronger semantics can be specified and tested.

`readChunks` returns its async iterator synchronously: unknown option keys reject during iterator construction, while chunk-range and path validation happen when iteration first starts, before native open. `writeChunks` always returns a promise; option and path validation failures reject that promise before native file dispatch, and native IO failures reject it as well. Preserve this boundary rather than changing the iterator factory into an async function.

### Settings, persistence, and secure storage

```ts
// /settings
createSettingsStore(options: { storage: SettingsStorage }): SettingsStore;
// Store: get(key), set(key, value), remove(key), update(key, updater).
// Missing => undefined; stored JSON null remains null.

// /settings/observable — explicitly integrates Legend State.
createObservableSettings(options): Promise<ObservableFile<SettingsValues>>;
createObservableFile(options): Promise<ObservableFile<Value>>;
// Handle: value$, error$, flush(), close(). Await the factory before editing.

// /secure-storage — chosen Expo subset.
getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
isAvailableAsync(): Promise<boolean>;
```

Keep async settings simple and injectable; define serialization only within the owning store unless actual cross-runtime locking is implemented. Corruption rejects and preserves bytes. Observable persistence adds schema/defaults, a named debounce interval and explicit flush guarantees; general file storage/path functions belong in files. Distinguish filename extensions from persistence table names.

Secure storage follows the selected Expo missing/null and options behavior where supported. Unsupported options reject. Remove the duplicate `secureStorage.get/set/remove` surface. If synchronous service-based access has a real in-repository need, retain it as an explicit macOS extension with missing=`null`, not empty string; it must not pretend to implement the async portable subset. [Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)

### Clipboard, links, notifications, updates, and system

| Boundary | Proposed contract |
|---|---|
| `/clipboard` | Keep `getStringAsync(options?)`, `setStringAsync(text, options?)`, `hasStringAsync()`. Remove redundant text aliases. Rich `readClipboard`/`writeClipboard` use owned payload types with exclusive file-list vs text/image alternatives; no hidden encoding ambiguity. |
| `/links` | Keep `openURL`, `canOpenURL`, `getInitialURL`, `addEventListener('url', listener)` semantics for the selected Expo subset. Keep `openPath(path)` as an explicit OS-opening extension; file reveal belongs in `/files`. Recent documents move to documents. |
| `/notifications` | `getNotificationPermission()`, `requestNotificationPermission(options?)`, `showNotification({ id, content })`, `scheduleNotification({ id, content, trigger })`, cancel/list operations, and typed response subscription. Immediate vs scheduled is explicit; cancellation of pending vs removal of delivered notifications is explicit. |
| `/updates` | One `getUpdateStatus`, `startUpdates`, `checkForUpdates(options?)`, `configureUpdates(options)`, typed event contract. Remove overlapping `AutoUpdater` facade. Checking returns when initiated; progress/completion arrives through events. Native app updater only. |
| `/system` | Keep information/events. Group login startup and power operations by named types, without forcing a new subpath for every function. `requestAttention({ kind })` and `preventSleep({ reason, kind })` return owned registrations. Dock operations are explicit macOS facilities and reuse menu types. |

Notification permissions distinguish status from ability to ask again where the backend provides it; do not fabricate a portable guarantee. Unsupported system options reject rather than returning “disabled.” URL initial/live/replay rules are documented separately. [Expo Linking reference for the adopted subset](https://docs.expo.dev/versions/v54.0.0/sdk/linking/)

### Processes

```ts
spawn(options: ProcessOptions): Promise<ProcessHandle>;
runCommand(options: RunCommandOptions): Promise<ProcessResult>;
resolveCommand(command: string): Promise<string | null>;
```

Use a discriminated executable target: absolute executable/helper reference vs PATH-resolved command. Put environment, cwd, input, timeout, signal, output callbacks and output limits in named options. Keep direct argument arrays, not implicit shell parsing. A handle supports write, closeInput, terminate and exited. Result distinguishes exit code, termination, timeout and truncation; no ambiguous `signal: boolean`. Stream bytes; optionally decode text according to a declared encoding. Command-runner convenience and mocks use the same sequential/concurrent and failure policy. No separate public command-runner abstraction unless injection actually needs it.

### Audio and auth

```ts
// /audio
createAudioPlayer(source: AudioSource, options?: AudioPlayerOptions): Promise<AudioPlayer>;
useAudioPlayer(source: AudioSource, options?: AudioPlayerOptions): AudioPlayerState;
createMediaSession(options: MediaSessionOptions): Promise<MediaSession>;

// /auth-session
createAuthSession(options?: AuthSessionOptions): Promise<AuthSession>;
// Session: state, redirectUri, open(url), dismiss().
```

`AudioPlayerState` discriminates loading/ready/error; ready carries Spark's player. This intentionally differs from Expo's hook returning its player immediately. Hook resource creation happens through lifecycle management, never during render. Player methods/status are Spark types; use seconds, async operation errors, explicit disposal, and typed media commands (`seekTo` requires a position). Loading accepts an optional timeout and abort signal. In the browser adapter, seek resolves only when the media element emits `seeked` (or immediately when already at the requested position); assignment failure, media error, source removal, and a 10-second completion timeout reject it. Later player commands wait for an accepted seek, and player removal cancels a pending seek before disposing the media element. Preserve metadata clear/replace and media-session ownership. Expo's hook lifecycle is a useful model, not a claim of drop-in interchangeability. [Expo Audio lifecycle](https://docs.expo.dev/versions/v54.0.0/sdk/audio/#useaudioplayersource-options)

Auth keeps success/cancel/dismiss/timeout outcomes and a prepared state/redirect. Specify when timeout starts, single-active-session behavior, cleanup, and abort-before/after-creation behavior. Basic random/digest helpers can remain explicit narrow exports; do not expose internal auth transport. A hook is justified only if it meaningfully owns session lifecycle, not to wrap every command.

### Drag/drop and UI

One `/drag-drop` component handles files/text/URLs/custom MIME payloads. Use consumer-facing event payloads consistently, explicit operations/coordinates, and `onError`/availability behavior instead of hard-coded English fallback UI. Remove the competing `/drag-drop/views` component and move music-specific track models out of the framework.

`/ui` owns the small common controls. `Button`, `TextInput`, `Select` share disabled/accessibility/testID/style/ref conventions; input-specific `onChangeText` and value-specific `onValueChange` remain recognizable. Controlled and uncontrolled input modes are explicitly typed. `NativeSelect` should not be a second ordinary selector with `enabled/onChange` vocabulary. Keep segmented control as a distinct control.

Keep coherent capability subpaths for split view, sidebar, glass, symbols, and search if their native cost or specialization warrants them. They use the same React Native baseline props and typed consumer events. Group AppKit chrome options; name pane composition and layout readiness. Apple symbols stay explicitly Apple-specific. Raw generated native components are internal.

Settings-window composition may remain under `/settings/window` because it is a distinct higher-level feature, not a React-versus-non-React split. Fold its options helper into that module. Normal and virtualized settings pages share page IDs, render vocabulary and controlled selection. Props must be exported by name. Styling adapters `/ui/uniwind` and `/ui/classnames` remain optional, explicitly library-specific integrations.

## 5. Concrete replacement boundaries for SQLite and WebView

### SQLite: own a deliberately small database contract

```ts
type SqlValue = null | string | number | Uint8Array;
type SqlRow = Record<string, SqlValue>;
interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  getAll(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  getFirst(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | null>;
}
interface Database extends SqlExecutor {
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
openDatabase(name: string, options?: DatabaseOptions): Promise<Database>;
```

`name` identifies a project-scoped file by default. Start with actual app requirements: parameter binding, row results, mutation metadata, transactions and close. Do not implement an ORM or SQL parser. `RunResult` needs explicit affected-row/insert-ID semantics. Define integer handling before promising fidelity: JS numbers must not silently represent unsafe SQLite integers; decide on a tested bigint or explicit string mode. SQL NULL maps to null, blobs to bytes, named/positional binding rules are deliberate.

Unknown database option keys, including keys whose value is `undefined`, reject with `E_UNSUPPORTED_OPTION`. When a backend fails with a recognized Spark error code, preserve that code and retain the backend error as `cause`; unknown backend errors become `E_NATIVE` with their cause preserved.

Transaction callbacks must use their supplied `tx`; operations on that connection are serialized, callback success commits, throw/rejection rolls back, nested transactions reject until deliberately supported. Define closure behavior for outstanding queries and invalid use of `tx` after callback completion. Cancellation is omitted initially unless the backend can safely interrupt it. Prepared statements, change subscriptions, encryption, vector search and remote replication are separate extensions when needed.

This is an ownership recommendation, not an assertion that a small adapter already guarantees backend equivalence. Audit repository DB use before implementation and either cover required operations in the owned contract or classify specialized calls as direct upstream usage. Expo SQLite provides query/transaction APIs, but its larger API is not the contract being promised here. [Expo SQLite reference](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/)

### WebView: own a component subset, not an upstream type alias

```tsx
type WebViewSource =
  | { uri: string; headers?: Record<string, string> }
  | { html: string; baseUri?: string };

// Sketch: actual props extend the appropriate React Native view props.
interface WebViewProps {
  source: WebViewSource;
  onMessage?: (event: { data: string; uri: string }) => void;
  onLoad?: (event: { uri: string }) => void;
  onError?: (event: WebViewErrorEvent) => void;
  onNavigationChange?: (state: WebViewNavigationState) => void;
}
interface WebViewRef {
  reload(): void;
  goBack(): void;
  goForward(): void;
  postMessage(message: string): void;
}
```

Keep React Native style/accessibility/testID/ref conventions in the final type. The ref methods request actions; they do not promise navigation completed. Events distinguish load/network failures. Define string message serialization, frame/origin identity and navigation ordering. Headers, HTML base URI, cookies/storage, script execution defaults, popup/external navigation and navigation interception must be specified and validated on supported targets before this becomes an accepted contract. Backend differences in these areas can be substantial.

The upstream WebView surface contains many specialized props; expose required functionality deliberately, not `WebViewProps extends UpstreamWebViewProps`. An internal adapter translates to the current library. If an application needs the full upstream surface, it should use `react-native-webview` directly and accept its lifecycle/types. Do not bolt arbitrary upstream props onto Spark's component. [Upstream WebView reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)

## 6. Configuration, tools, and complete export disposition

Config is an API too. Own `SparkConfig`, platform options and plugin inputs; generate or verify JSON schema against those types. Replace `any` results in config declarations. Keep setup recipes for supported application modes explicit. CLI commands validate options per command and distinguish build/package/release and development-target support. Native/Metro integration can remain exported for generated projects without being presented as application runtime APIs.

This map accounts for all 63 original umbrella entries. “Fold” means update callers and delete the old export in the same change, not leave a forwarding alias.

| Existing exports | Proposed destination/action |
|---|---|
| `/app`, `/app/exit` | `/app`; one lifecycle/quit contract. |
| `/app/documents`, `/app/recent-documents` | `/app/documents`; one document/open-request contract. |
| `/windows`, `/windows/managed`, `/windows/react`, `/windows/controls` | `/windows`; one public window contract. |
| `/menus`, `/context-menu`, `/tray` | Keep feature boundaries; share menu/shortcut/image types internally and publicly where useful. |
| `/shortcuts`, `/global-shortcuts`, `/global-shortcuts/hotkeys` | Keep local/global feature boundaries; fold singleton numeric hotkey interface into the canonical global API or explicit low-level keyboard usage. |
| `/shortcuts/keyboard` | Retain low-level events/codes with explicit ownership. |
| `/shortcuts/commands`, `/shortcuts/commands/storage` | Keep commands; fold storage helper into its module if it can remain optional internally, otherwise label it as a distinct persistence integration. No duplicate key syntax. |
| `/dialogs`, `/message-dialog` | `/dialogs`; IO and reveal to files. |
| `/files`, `/files/scanner`, `/files/watchers` | `/files`; keep internal operation modules and operation-scoped lifetimes. |
| `/settings`, `/settings/paths` | Settings stays; general storage/path helpers move to files. |
| `/settings/observable` | Retain explicit Legend State integration, shared storage backend. |
| `/settings/window`, `/settings/window/options` | `/settings/window`; one page/options contract. |
| `/clipboard`, `/secure-storage`, `/links` | Keep; selected Expo methods plus owned extensions; remove duplicate aliases. |
| `/notifications`, `/updates`, `/processes`, `/processes/commands`, `/system` | Keep capabilities; fold commands helper into processes; consolidate duplicate facades. |
| `/audio`, `/auth-session` | Keep owned resource contracts and hooks in each feature. |
| `/drag-drop`, `/drag-drop/views` | `/drag-drop`; generic payloads, one component contract. |
| `/sqlite`, `/webview` | Keep only as real Spark-owned contracts, replacing passthrough backend types. |
| `/ui`, `/ui/select-controls`, `/ui/search` | Common controls in `/ui`; retain a specialized search import only if native loading cost warrants it. Remove duplicate Select contracts. |
| `/ui/split-view`, `/ui/sidebar`, `/ui/glass`, `/ui/symbol` | Keep coherent specialized UI capabilities; own types and availability behavior. |
| `/ui/uniwind`, `/ui/classnames` | Keep explicit styling integrations. |
| `/config`, `/schema.json`, `/config-plugin`, `/expo-config` | Keep typed app configuration/plugin roles; one documented composition path per project mode. |
| `/metro`, `/expo-metro`, `/universal`, `/native` | Consolidate documented Metro setup under `/metro`; retain native config integration as `/native`. Remove duplicate orchestration exports after generated configs are updated. |
| `/runtime-entry`, `/metro-gate`, `/init-template` | Internal/generated-project tooling; retain only exports actually needed by generated projects, label them accordingly and test them. |
| `/cli`, `/package.json` | Keep command/metadata boundaries; not ordinary runtime SDK APIs. |

## 7. Implementation order and acceptance

1. Agree on capability ownership, the selected Expo subsets and shared conventions. Record intentional divergences. Do not start with a mass rename.
2. Consolidate errors/availability/event/resource handling and public type ownership. Add conformance tests for selected Expo methods and import-without-module tests.
3. Deliver windows and app/document lifecycle as one coherent feature cleanup, then shared menus/shortcuts/tray/Dock. Preserve real advanced behavior.
4. Consolidate dialogs/files/settings and then clipboard/links/secure storage/notifications/system/processes/updates. Each unit includes its callers and removes obsolete APIs.
5. Define and test the owned audio, SQLite and WebView contracts against actual consumer requirements before replacing their public types. Shared signatures alone do not prove substitutability.
6. Align UI/drag-drop/settings composition and typed configuration/tooling. Snapshot declarations and ensure every original export is either retained intentionally, replaced, or removed.

For each feature: compile consumer examples; test success, malformed input/native output, cancellation, missing modules, permission failures and cleanup; check callbacks/resources across unmount and repeated calls. Test the applicable native targets for lifecycle, coordinates, files, keychain, notifications and embedded browser/database behavior. Measure performance where an adapter changes copying, IO, rendering or resource lifetime. No broad native rewrite or new backend registry is required.

Existing tests and native implementations remain useful. Changes are direct replacements because there are no users. External dependency upgrades are separate decisions; using Expo conventions does not imply installing newer Expo packages.

## Evidence and remaining design work

Inspected the current export map, existing ownership policy, Expo adapters, and SQLite/WebView/audio/auth public contracts. Consulted official SDK 54 documentation to match Spark's current baseline and upstream WebView documentation for its contract breadth. Sources are linked next to the relevant claims. New names, boundaries and examples here are recommendations, not claims about existing APIs.

This document covers every API family and every existing umbrella export. It is not a finished declaration specification for every method: menu toolbar extensions, SQL integer/result behavior, complete WebView behavior/defaults, precise permission types and some platform-specific window options require explicit final definitions and tests. Those are bounded implementation/design decisions, not reasons to leave API families out of scope.

Implementation progress and verification are tracked in [API cleanup](api-cleanup.md).

The [API design rules](api-design.md) govern imperative cores and optional React bindings for all capability families.
