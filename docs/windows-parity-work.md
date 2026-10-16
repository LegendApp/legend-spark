# Remaining Windows parity implementation

Continue the agreed priority list, preserving the existing public macOS contracts
and using replaceable Windows backends. One commit per group. Native acceptance
is performed on Windows; generation and bundling never imply runtime success.

- [x] 1. Filesystem and persistent settings (`99cc5d7`).
- [x] 2. Native message dialogs and context menus (`6fcdee8`).
- [x] 3. Drag/drop, recent documents, file/URL associations (source implementation; native behavior not yet verified).
- [x] 4. Tray and global shortcuts (source implementation; native behavior not yet verified).
- [x] 5. Notifications and response lifecycle (source implementation; native behavior not yet verified).
- [x] 6. Owned/modal windows and fuller menus (source implementation; native behavior not yet verified).
- [x] 7. Processes and system APIs (source implementation; native behavior not yet verified).
- [x] 8. Nitro, SQLite, WebView, secondary Hermes runtimes (source integration; native behavior not yet verified; optional shared-main-module mode remains unsupported).
- [x] 9. Rich clipboard and development connection/bundle options (source implementation; native behavior not yet verified).

Standalone distribution was deferred for the internal development slice; the
current task continues the development feature priorities. Track actual native limitations in
[windows-issues.md](windows-issues.md), with shared acceptance evidence in
[platform-testing.md](platform-testing.md).

All groups now have source implementations for the development contracts; optional upstream-library modes and platform-specific limits remain explicit in the issues document. Windows native builds and interactive
acceptance remain unverified. The test catalog marks only standalone distribution
and updates as missing; implementation status is not a test pass.

The later [public API audit](desktop-parity-audit.md) found incomplete options,
events, and behavior within these groups. These checkmarks mean a feature has an
implementation, not that its full macOS contract is implemented on Windows. Use
the audit's prioritized findings for the next implementation batch.

## Commits and local validation

| Group | Implementation commits |
| --- | --- |
| Recent documents and associations | `f1669c6` |
| Drag/drop | `7aa133b`, `8bdf21d` |
| Tray and global shortcuts | `32e6669` |
| Notifications | `7bc183a` |
| Modal windows and menus | `bf9a515` |
| Processes and system | `1b5d5fb` |
| Nitro, SQLite, WebView and Hermes | `ae5e951`, `9ac6570` |
| Rich clipboard and Metro flags | `67e1fb1` |

Local validation on macOS: 202 repository tests, typechecking, SDK packing, fresh
Windows ARM64 and macOS generation/main bundles, a separate Windows worker bundle,
and the full 30-package Windows prebuilt dependency profile/prebuild passed.
The prepare reports have no runtime passes: Windows records 38 untested cases and
two deferred distribution implementations; macOS records 40 untested cases.
Reports are generated under `.spark/test-results` and are not committed.
