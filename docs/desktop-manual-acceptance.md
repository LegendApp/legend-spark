# Manual desktop acceptance

Run this on **both macOS and Windows**, from the same commit. Keep separate results
for Windows ARM64 (including Parallels) and x64. Passing on one architecture does
not establish the other. This checklist covers development use; standalone release
builds, installation and updates need separate acceptance.

## 1. Install and rebuild once

Use an interactive desktop and a physical keyboard. On Parallels, make sure the
shortcut reaches Windows rather than being intercepted by macOS. Use disposable
files and avoid depending on important clipboard contents during the tests.

Follow the native prerequisites in [Windows setup](windows-slice.md#set-up-the-windows-machine)
or install the macOS Xcode/CocoaPods prerequisites in the main README. Install
packages on each machine; do not copy `node_modules` from another OS.

From the repository root:

```sh
bun install
bun run typecheck
bun run test
cd examples/kitchen-sink
```

On macOS:

```sh
npm run rebuild:macos
npm run macos
```

On Windows:

```powershell
npm run rebuild:windows
npm run windows
```

The explicit rebuild is necessary for native fixes, including the macOS keyboard
fix. Fast Refresh or Metro restart cannot update an existing native runtime.
Subsequent screen edits only need the normal `macos`/`windows` command. Confirm the
CLI opens the matching runtime without a compatibility warning.

## 2. Keyboard/WebView regression

In Kitchen Sink's desktop expansion section:

1. Focus the embedded WebView's **WebView keyboard test** input. Type, select all,
   replace text, use arrows, Tab, Escape and copy/paste. Native inputs must also
   continue to work after focus moves out of WebView.
2. On macOS, register **⌘⇧F12** and press it with the WebView focused. Repeat 20
   times, then click **Send a message to React Native**. Expect no crash or frozen
   window, a WebView message in its feedback panel, and shortcut callback feedback.
   If function keys control media, hold Fn as needed.
3. Remove the shortcut and repeat the key combination. The app must remain usable,
   without further shortcut callbacks. Register again and verify callback delivery
   also works while another app is foreground.
4. On Windows, perform the same editing/messaging checks and use the shared
   runner's **Control+Alt+Shift+F11** check below for global shortcut delivery.
   A missing or placeholder WebView is a failure, not a completed keyboard check.
5. Reload through Expo's `r`, then repeat. A registration must not produce duplicate
   callbacks after reload or prevent a fresh registration.

The macOS native regression can also be rerun from the repository root:

```sh
bun scripts/test-keyboard-events.ts
```

It builds a custom test runtime and checks nine native assertions, including
untagged views, delivery once to a tagged ancestor, key-up/down, native filters,
and dead keys. Its report is `.spark/keyboard-tests/report.json`. This does not
replace physical global-shortcut delivery testing.

## 3. Run the shared acceptance app

Stop the Kitchen Sink session with Ctrl+C. From the repository root, run the
appropriate command (allow time for a fresh consumer and native compilation):

```sh
bun run test:platform --platform macos --timeout 1800
```

```powershell
bun run test:platform --platform windows --timeout 1800
```

Use the interactive run, without `--api-only`. Follow each onscreen instruction
before pressing **Finish run**:

- Click the native button, enter `Native edit`, and select `Second`. Verify the
  result indicators change from actual callbacks.
- Run WebView loading/injection/messaging and confirm SQLite, Nitro and independent
  Hermes runtime checks report success. A bundle or mounted view alone is insufficient.
- Complete dialogs (including checkbox and cancel), context menus, modal windows,
  native menus and shortcut checks. For the global shortcut, focus another app and
  physically press **Control+Alt+Shift+F11** within the displayed deadline.
- Open the tray/menu-bar icon and choose **Checks → Continue**. On Windows check
  the hidden-icons overflow. Confirm checked/disabled menu items look correct.
- Run notifications, allow permission when requested, and click the notification
  within the deadline. Scheduled-notification cancellation must also pass. Record
  a missing prompt/banner or denied permission explicitly; do not count it as a pass.
- Complete filesystem, streaming/Trash, settings, system/taskbar and drag checks
  exposed by the screen. Read failures rather than merely checking that the app survives.

If a prompt hangs, preserve the partial report and logs before stopping. A timeout
or unexecuted case remains a validation gap.

## 4. Exercise ordinary use

Use Kitchen Sink and [Notes Lite](example-apps.md) for these checks on each OS:

| Area | Acceptance |
| --- | --- |
| Windows and focus | Repeatedly open/close secondary windows immediately; move between displays; minimize/restore; confirm modal parent blocking and close/quit guards. Reload with secondary windows open, then open them again. |
| Refresh | Change a screen label after incrementing a counter. Fast Refresh updates it without losing supported component state. Leave idle for a minute: no refresh loop. Full reload reconnects and retains no stale menu/tray/shortcut resources. |
| Persistence | Create/edit a Notes Lite document, close the app and reopen it. Content and settings persist. Exercise save cancellation and unsaved-change guards without losing the original file. |
| Files | Use disposable Unicode-named files/directories. Test streaming and Trash/Recycle Bin, then restore through Finder/Explorer and verify contents. Try a denied-access location and expect an actionable error. |
| OS integration | Drag disposable files from Finder/Explorer into the app and drag supported data out. Check tray, Dock/taskbar actions, theme switching and focus behavior. Native callback tests alone do not prove cross-app drag/drop. |
| Helpers | Run the helper example, exercise crash/restart and request timeout, then quit normally. No owned helper should remain. Repeat after forcibly ending the app and record recovery behavior. |

macOS supplemental regressions, from the root:

```sh
bun scripts/test-sidecars.ts
bun scripts/test-fabric-reload.ts
```

On Windows also run the native feature/lifecycle suite with a fresh short path:

```powershell
bun run test:windows:features --project C:\dev\SparkAcceptance
```

The [Windows issue matrix](windows-issues.md) records platform-specific pending
acceptance. These commands do not turn untested cases into passes.

## 5. Preserve results

Collect `.spark/test-results/<run-id>.json` from each machine, plus any referenced
build/app logs. Record commit, OS, architecture, runtime mode, and manual pass/fail
notes. For a crash include macOS `~/Library/Logs/DiagnosticReports` or the Windows
crash/Event Viewer details and the exact focus/key/action sequence.

```sh
bun run test:report --output .spark/platform-coverage.md
```

Copy portable JSON reports into one directory to compare machines:

```sh
bun run test:report ./reports --strict --output coverage.md
```

`--strict` deliberately fails for untested applicable cases. Keep partial failures
and results from different commits separate; a green build is not parity evidence.
