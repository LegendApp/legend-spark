# Desktop application capabilities

The public API is `@legendapp/spark`. Implementation packages are private and
ship inside that package. Desktop apps should not install the implementation
packages separately or link parallel native modules for these capabilities.

| Capability | Public entry point |
| --- | --- |
| Windows, root registration and hooks | `@legendapp/spark/windows` |
| AppKit toolbar operations and animation | `@legendapp/spark/windows/macos` |
| Native split view and sidebar | `@legendapp/spark/ui/split-view`, `ui/sidebar` |
| Document lifecycle and recent documents | `@legendapp/spark/app/documents`, `app/recent-documents` |
| Routed commands and persisted bindings | `@legendapp/spark/shortcuts/commands` |
| Keyboard events | `@legendapp/spark/shortcuts/keyboard` |
| Glass, symbols, select/segmented controls, search | `@legendapp/spark/ui/glass`, `ui/symbol`, `ui`, `ui/search` |
| File scanning (macOS) and invalidation watches | `@legendapp/spark/files` |
| Settings window and observable preferences | `@legendapp/spark/settings/window`, `settings/observable` |
| Menus, dialogs and context menus | `@legendapp/spark/menus`, `dialogs`, `context-menu` |
| Drag/drop views | `@legendapp/spark/drag-drop` |
| Process execution and command lookup | `@legendapp/spark/processes` |
| System hotkeys | `@legendapp/spark/global-shortcuts`, `global-shortcuts/hotkeys` |
| Secure storage and updates | `@legendapp/spark/secure-storage`, `updates` |

These newly extracted native controls and managed-window APIs target macOS.
The existing portable APIs retain their platform implementations. The numeric
key-code hotkey adapter and synchronous service-based Keychain facade are
macOS-specific; use accelerator shortcuts and asynchronous `secureStorage`
for other desktop platforms.

Document and settings-window helpers are optional packages in the dependency
graph. Importing the base app lifecycle does not automatically pull in document
windows, file APIs, or settings UI. Settings UI has an optional peer dependency
on `@legendapp/list` and uses its public scrolling APIs.

## Native ownership

Managed and basic windows share a native registry. Windows and their React
surfaces survive JavaScript runtime replacement; runtime listeners are rebound
and closed windows release their registry entries. Close and quit guards remain
opt-in. Apps choose the `RNWindowManagerStartup` and `RNRecentDocumentsStartup`
plugins through `macos.lifecycle.plugins` when they use those startup behaviors.

Menus and dialogs use the existing Spark providers. Command batches use Spark's
process engine. Key-code hotkeys use the existing global-shortcut registry.
Both updater APIs share the same Sparkle instance. The richer select control
also backs the standard macOS `Select` component.

## Existing Keychain services

The normal async secure-storage API remains scoped to the Spark project.
A standalone macOS app migrating an existing service can list its exact service
name in `macos.infoPlist.SparkKeychainServices`. `getSecureStorage()` then exposes
synchronous get/set/remove and cryptographic base64url generation. The Spark
Runner cannot access custom service names. Do not rename an existing service
unless the app intentionally migrates its stored credentials.

## Validation

Run `bun run test`, `bun run typecheck`, and
`bash packages/desktop-windows/tests/registry-lifetime.test.sh`.
Native consumer builds and app-specific runtime checks are also required after
changing native sources or package ownership; a Metro reload cannot load new
TurboModules or native view providers.

See [commands and keyboard input](commands.md) for named bindings, routing, capture and persistence.
