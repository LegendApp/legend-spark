# #79 Shortcut map: verification

I opened and checked every image.

From `bun run ks:capture keyboard/shortcut-map` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). The capture shows the top of the screen (the window is 1000×700 points); the examples, reserved list, availability and activity sections are below it.

| Image | Flags | What it shows |
|---|---|---|
| keyboard-shortcut-map-light.png | `--appearance light` | All seven demo commands with scope (App, Window, View, Global), default bindings, Record/Unbind/Reset. No Customized badges; Reset is disabled. Clear console (⌘⇧K) shows a live conflict with the app controller's `registerShortcut("Command+Shift+K")`, read from the shared shortcut inventory. |
| keyboard-shortcut-map-dark.png | `--appearance dark` | The same in dark; the HotkeyCapture control picks up the app tokens added to `global.css`. |
| keyboard-shortcut-map-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left: titles at the right, actions at the left, the conflict line aligned to the leading edge. Accelerators stay untranslated. |
