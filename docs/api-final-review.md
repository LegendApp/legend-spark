# API design review — September 29, 2026

The approved API design work is implemented. Spark capabilities have imperative
owners, optional React bindings, explicit public types, and documented lifecycle
contracts. The design is ready to use for new applications; full native platform
acceptance is still incomplete. This report distinguishes those two conclusions.

## Complete public surface

The [export inventory](api-export-inventory.json) accounts for every one of the
63 original entries at `5e17417`. Seventeen superseded paths are gone; three explicit
paths were added: `/contracts`, `/windows/macos`, and `/diagnostics`. The package now
has 49 exports. `tests/api-export-inventory.test.ts` checks every disposition against
the actual package exports and verifies targets and configuration declarations.
The [implementation record](api-cleanup.md) records the changes and checks per family.

| Current entries | Design decision |
|---|---|
| `/app`, `/app/documents`, `/windows` | Typed identity, events, ownership and guards; document and window coordination works outside React. |
| `/windows/macos`, `/diagnostics` | Explicit AppKit commands and diagnostic timing, separated from ordinary window operations. |
| `/menus`, `/context-menu`, `/tray`, `/system` | Shared menu language, owned registrations and creation-time callbacks; distinct OS capabilities remain explicit. |
| `/shortcuts`, `/global-shortcuts`, `/shortcuts/keyboard`, `/shortcuts/commands` | One accelerator language; local, global, low-level and routed command lifetimes remain distinct. |
| `/files`, `/dialogs`, `/settings`, `/settings/observable` | Path/byte IO, explicit dialog ownership and typed storage; observable integration intentionally exposes Legend State semantics. |
| `/clipboard`, `/secure-storage`, `/links` | Deliberately selected Expo-shaped methods with documented Spark extensions. |
| `/notifications`, `/updates`, `/processes` | Owned options, results and errors; cancellation/nonzero process exit are distinct from operational failure. |
| `/audio`, `/auth-session`, `/sqlite`, `/webview` | Spark-owned resource/component contracts hide backend objects and types. |
| `/drag-drop`, `/ui`, `/ui/search`, `/ui/split-view`, `/ui/sidebar`, `/ui/glass`, `/ui/symbol`, `/ui/swipe`, `/settings/window` | Named React Native props and consumer events; specialized native capabilities retain explicit boundaries. |
| `/ui/uniwind`, `/ui/classnames` | Explicit ecosystem integrations rather than promises of backend independence. |
| `/contracts` | Shared error, availability and registration vocabulary. |
| `/config`, `/schema.json`, `/config-plugin`, `/expo-config` | Typed Spark-owned configuration plus explicit upstream Expo composition. Schema field checks prevent accidental drift. |
| `/metro`, `/native` | Canonical typed build configuration recipes for Spark-owned and existing Expo projects. |
| `/runtime-entry`, `/metro-gate`, `/init-template`, `/cli`, `/package.json` | Generated-project tooling and metadata, not ordinary application capabilities. |

## Final improvements

Configuration no longer exposes `any` reader results. Initial window settings use
grouped sizes and explicit platform options; macOS startup sizing now measures the
outer frame, matching the runtime contract. JSON schemas track owned public fields
and allow Expo composition to inherit macOS metadata from its base configuration.

Metro setup is consolidated under `/metro`, with native configuration under `/native`.
CLI commands reject irrelevant flags and extra arguments before resolving projects
or starting side effects. Superseded build aliases are removed.

The consumer review covered music service ownership, the document editor's
multi-window sessions, and configuration composition. Music already owns its player
in an application service through `createAudioPlayer`; it does not need a component
mount. The document editor keeps its application-specific session model and uses
lower-level guards and registrations, rather than being forced into a single-window
controller abstraction. The optional document controller now uses
`onMenuAction(action, controller)` instead of a factory returning another handler
map, and reports rejected async actions. Its owning hook retries failed old-owner
cleanup before acquiring a replacement. Process error paths preserve both the
original failure and a failed termination in an aggregate cause.

## Intentional differences

| Difference | Why it remains |
|---|---|
| Imperative APIs versus hooks | Capabilities work without React; hooks only manage component ownership or observation. Context hooks and components are inherently React-specific. All nine public hooks are classified by an architectural test. |
| `remove`, `close`, `terminate`, `dismiss` | Removing a registration, closing IO/storage, terminating a child and dismissing a session have different meanings. A universal disposal spelling would conceal those differences. |
| Synchronous versus asynchronous removal | In-process listeners can detach immediately; native registrations and resources must acknowledge cleanup. Async cleanup joins concurrent calls and supports safe retry. |
| Promise factory versus immediate controller with `ready` | Most creation is asynchronous; a controller exposes its handle immediately when cancellation during setup matters. Readiness is documented separately from application callback completion. |
| Expo `Async` names versus Spark commands | Selected Expo methods retain their actual result and error contracts. Spark-owned APIs follow Spark conventions; there is no claim of complete Expo package compatibility. |
| Owned capability versus upstream integration | SQLite, WebView and audio have deliberate owned boundaries. React Native, routing, state and styling retain their upstream object models where wrapping them would not provide meaningful independence. |
| Platform-specific options | RN is the framework. Typed OS options describe real support differences without adding multi-framework layers or pretending every target is equivalent. |

## Verification and limits

Final checks: workspace TypeScript passed; all 523 tests across 105 files passed,
including the packed SDK consumer, export/hook inventories and compiled native fixtures.
The final targeted rerun for Expo inheritance/export assertions also passed.
The regression suite includes transport/React tests and lightweight compiled macOS
fixtures using actual native implementation sources. Some fixtures replace RN bridge
declarations or window objects with test doubles; they do not prove Fabric integration,
interactive focus/layout, permissions, notifications, playback, or signed update flows.

No Windows machine/toolchain is available, as confirmed by the user. Windows native
compilation and runtime acceptance therefore remain unverified. The available cached
macOS Runner predates these changes and cannot establish acceptance of this source.
A fresh full host build was not started: available disk headroom above the required
50 GB reserve was approximately 9 GB, insufficient to safely budget a full rebuild
with uncertain growth. Interactive host acceptance remains pending. Android compilation/playback and the other OS interaction gaps remain
listed in the per-family implementation record.

Future API additions must follow [API design rules](api-design.md), update the export
and hook inventories when applicable, and pass consumer types plus relevant behavior
and native checks. No migration aliases or backend registry were introduced.
