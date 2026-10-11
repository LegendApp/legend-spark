# #87 Text services: verification

Every image was opened and checked.

| Image | How | What it shows |
|---|---|---|
| text-input-editing-text-services-light.png | `bun run ks:capture text-input-editing/text-services --appearance light` | Availability from the native module on this Mac (all four `{"available":true}`; this Mac supports Writing Tools), the note (a multiline RN TextInput), the Spark TextInput, the Look Up button and the first `writingToolsBehavior` inputs. The Find section is below the 1000×700 pt window. |
| text-input-editing-text-services-dark.png | `--appearance dark` | The same in dark. |
| text-input-editing-text-services-light-ar.png | `--appearance light --locale ar` | Arabic UI, right to left. The sample note stays English on purpose (Match case needs a cased script). |
| find-bar-shown-light.png | `takeScreenshot` in `e2e/flows/text-input-editing/find-bar-driver.yaml` (`--backend driver`), after Show the find bar and scrolling to the top | `showFindBar` resolved (`Result: ok`) and the NSTextFinder find bar (Find field, previous/next, Done, Replace) is inside the note, enabled by the config-plugin patch. |
