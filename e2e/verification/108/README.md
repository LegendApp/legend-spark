# #108 Dialogs API: verification

I opened and checked every image.

## Kitchen Sink screen

From `bun run ks:capture dialogs/panels` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). The driver captures app windows, not modal panels, so these show the triggers and availability readouts only.

| Image | Flags | What it shows |
|---|---|---|
| dialogs-panels-light.png | `--appearance light` | Availability: all six queries `{"available":true}`. Triggers for open/save accessory panels, Empty Trash ("Don't ask again"), Confirm, Rename and Unlock prompts, and both About panels. Results read `—` until a dialog runs. |
| dialogs-panels-dark.png | `--appearance dark` | The same in dark. |
| dialogs-panels-ar-light.png | `--appearance light --locale ar` | Arabic labels, laid out right to left: sections start at the right, buttons and headings align to the leading (right) edge. JSON readouts stay untranslated. |

## Panels, rendered offscreen

From `SPARK_DIALOG_RENDER_DIR=$PWD/e2e/verification/108 bun run test tests/dialog-native.test.ts`. The harness builds each NSAlert and accessory view with the modules' own builders and renders it with `cacheDisplayInRect` at 2x. Nothing is presented: no panel runs, no window is ordered onto a screen, and the harness asserts that. Windows are never key here, so default buttons are not drawn in the accent color.

| Image | What it shows |
|---|---|
| save-accessory-light.png, save-accessory-dark.png | The save panel accessory: a "Format:" pop-up with Markdown selected and a checked "Include metadata" checkbox, aligned in a two-column grid. |
| save-accessory-ar-light.png | The same controls with Arabic labels and right-to-left layout (set on the views, as an Arabic app lays them out): label on the right, pop-up and checkbox to its left. |
| alert-suppression-light.png, alert-suppression-dark.png | A warning alert with Cancel, Empty Trash and an unchecked "Don't ask again" suppression checkbox. |
| prompt-light.png, prompt-dark.png | A text prompt with "Untitled" in its field and Cancel/Rename buttons. |
| prompt-secure-light.png, prompt-secure-dark.png | A secure prompt: the field shows bullets for its 7-character value. |

The original About panel was not rendered. The native harness also checks that the module updates and reuses one panel, resets omitted overrides to bundle values, and releases it on invalidation.
