# #64 Window tabs: verification

Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). Driver mode never
puts a window on screen (docs/test-driver.md). Each image below was opened and checked.

Main window, `bun run ks:capture windows/window-tabs`:

| Image | Flags | What it shows |
|---|---|---|
| windows-window-tabs-light.png | `--appearance light` | `Native window tabs: available`, the empty readout (0 groups, no events), the eight actions. |
| windows-window-tabs-dark.png | `--appearance dark` | The same in dark. |
| windows-window-tabs-light-ar.png | `--appearance light --locale ar` | Mirrored layout: sidebar on the right, readout right-aligned, button pairs reversed. Screen strings are English, area names Arabic. |

`takeScreenshot` outputs of `e2e/flows/windows/window-tabs-driver.yaml` (`--backend driver`):

| Image | Run | What it shows |
|---|---|---|
| window-tabs-group-light.png | `open,tab-1,tab-1` | One group `1 2 [3]`, tab bar shown; window 1 heard group change `1-2-3` and selection `3`. |
| window-tabs-merged-dark.png | `open,open,disallowed,open,merge-1,tab-3` | `[1] 2 4` merged with the tab bar shown, `[3]` (tabbing disallowed) left alone, and the `E_INVALID_ARGUMENT` rejection of a new tab next to window 3. |
| window-tabs-merged-light-ar.png | same | The same, light, Arabic. |

Only a person can check on screen: AppKit's tab bar and its tabs, the + button, the Window and
View menu items, dragging tabs, the cascaded frame of a moved tab and automatic tabbing
(`e2e/flows/windows/window-tabs-macos.yaml`, black-box with manual steps; not run).

Goldens: the light `windows-window-tabs` goldens are runner captures and match. The dark ones differ
from today's render only in the 975 pixels of the window title "KitchenSink" (#283), like every other
dark golden on this host today; they carry the title as the other dark goldens do.
