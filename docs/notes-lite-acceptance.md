# Notes Lite acceptance

Create an isolated app with `spark create NotesAcceptance --example notes-lite`,
install/select its compatible Spark Runner or build a development runtime,
and run `npm run macos` or `npm run windows`. Use disposable notes. The example
source is in `packages/cli/templates/notes-lite`; an already-created app does not
receive template edits automatically.

## Automated checks

Run `bun run test -- tests/example-models.test.ts`. It covers snapshot recovery, failed
save/retry, concurrent close/quit during edits, old notebook compatibility, shared
view notifications, persisted theme/session, disconnected-display spark fitting,
idempotent restoration, filtering deleted notes, and retaining the open-window
set during quit. Window orchestration uses an injected host; these tests do not
claim OS-native acceptance.

`bun run test:examples` creates packed consumers and typechecks/bundles the examples
for web, iOS, Android, macOS, and Windows. This checks platform separation, not
native interactions.

## Desktop acceptance sequence

1. Create notes A and B. Exercise New, Search, and Delete via their buttons, File
   menu items, and shortcuts. Each action must occur once. Search from a secondary
   window must focus the main window's search field. Delete is recoverable.
2. Open A in its dedicated window. Open it again: the existing window should focus,
   without a duplicate. Keep B selected in the main window, edit A in its window,
   and verify A's row updates. Delete A: B remains selected and A's window displays
   the deleted-note message. Restore A from Recently deleted: its window becomes
   editable again with its saved text.
3. Open Settings. Select Dark, Light, then System. Every Notes window must update.
   In System mode, change OS appearance and verify Notes follows. Quit and relaunch:
   the preference survives. Repeat Settings opening to confirm it stays a singleton.
4. Move/resize main, A, and Settings; quit immediately after editing A. Relaunch:
   the latest text and open windows return. Close Settings manually, then quit and
   relaunch: Settings must stay closed. Repeat after moving a note window onto a
   display that is disconnected before relaunch: the window must be accessible on
   a connected display. Test with displays placed left/above the primary display.
5. Exercise a failed persistence write in a disposable development consumer (use
   the injected failing record writer from the automated tests for deterministic
   model coverage; do not change permissions on a real notebook). Close/quit must
   be vetoed, the error shown, and the note retained. Remove the failure and retry:
   persistence and subsequent close/quit must succeed. Native fault injection is
   an additional target-machine check, not covered by the model test alone.
6. Edit during a save and close another window. The newest edit must survive a
   relaunch. Fast Refresh the app, then use each command: no duplicated menu
   contributions/actions or duplicate close-guard error should appear.

## Recorded evidence for this change

- Generated consumer typecheck and all five platform bundles passed.
- Web interaction checked creation/editing, persisted text after reload, search
  button focus, Light/Dark visual rendering, and persisted Dark selection.
- A freshly generated macOS consumer built and ran. Native checks passed for
  shared edits between main and note windows, singleton note-window reopening,
  Dark appearance in Settings and note windows, persisted theme, File menu Search,
  Command+F from Settings, Command+N, Command+Shift+Backspace, the deleted-note
  message, and quit/relaunch restoration. An edit immediately before Command+Q
  survived relaunch, and the dedicated note window reopened with its text.
- Windows native interactions, physical display removal, OS appearance changes
  while System is selected, and native fault-injected save/quit still need the
  sequence above. Those failure paths have model/host coverage, not native acceptance.
