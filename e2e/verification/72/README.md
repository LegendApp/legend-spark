# #72 Toolbar: verification

Built with `ks-lock native bun run rebuild:macos` (Kitchen Sink dev build of this branch). I opened and checked every image.

Main window, `bun run ks:capture windows/toolbar` (driver mode, nothing shown on screen):

| Image | Flags | What it shows |
|---|---|---|
| windows-toolbar-light.png | `--appearance light` | Open/Close buttons, `getToolbarAvailability(feature)` for the five features (`available` on macOS), the four rows at their initial values, Refresh state and Customize toolbar…. No child is open, so the state block shows only "last event: none". |
| windows-toolbar-dark.png | `--appearance dark` | The same in dark. |
| windows-toolbar-light-ar.png | `--appearance light --locale ar` | Layout mirrored: sidebar on the right, rows read right to left. Screen strings are English, area names Arabic. |

Child window, `bun e2e/verification/72/capture-child.ts` under `ks-lock native`. It presses Open child
window and the listed rows' Next buttons with the driver, waits for each row's new value, and captures
the child with `id:windows-toolbar-child`. Driver mode never puts the child on screen
(docs/test-driver.md). The script printed `getToolbarState` for each run; those lines are quoted below.

| Image | Flags | What it shows |
|---|---|---|
| toolbar-icon-light-child.png | `--appearance light` | Icon only: the sidebar item (AppKit's symbol) at the leading end, then the View segmented control, the Sort menu, New and Share. "overflow: none". |
| toolbar-icon-dark-child.png | `--appearance dark` | The same in dark. |
| toolbar-icon-light-ar-child.png | `--locale ar` | The same. `-AppleLanguages (ar)` does not lay the title bar out right to left (as in #65), so the items keep their left-to-right order. |
| toolbar-icon-and-label-light-child.png | `--steps display-mode` | Icon and label: Sidebar (AppKit's localized label), View, Sort, New, Share under the controls. "display mode: iconAndLabel". |
| toolbar-label-light-child.png | `--steps display-mode,display-mode` | Label only: each item shows its label. "display mode: label". |
| toolbar-narrow-light-child.png | `--steps width` | The window at 420 points: only the sidebar item fits; the rest are behind AppKit's » overflow button. "overflow: view, sort, new, share". |
| toolbar-narrow-dark-child.png | `--steps width --appearance dark` | The same in dark. |
| toolbar-narrow-light-ar-child.png | `--steps width --locale ar` | The same, "overflow: view, sort, new, share". |
| toolbar-hidden-light-child.png | `--steps shown` | `shown: false`: the toolbar is hidden and the title bar is back to its plain height. "shown: no", "items: sidebar, view, sort, new, share". |

Not visible in any in-process capture: the overflow menu's contents, the customization palette (a sheet; the
driver never shows windows, and `showToolbarCustomizationPalette` rejects `E_UNAVAILABLE` under the driver)
and a click on a toolbar item. The native harness (`tests/window-manager.native.mm`) covers them on real
`NSToolbar`s: menu forms and their events, the sidebar item's `toolbarAction`, overflow at 360 points,
and saving and restoring a customized layout. `e2e/flows/windows/toolbar-manual.yaml` lists the steps a
person signs off.
