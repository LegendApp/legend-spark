# #65 Window options: verification

Built with `ks-lock native bun run rebuild:macos` (Kitchen Sink dev build of this branch). I opened and checked every image.

Main window, `bun run ks:capture windows/window-options` (driver mode, nothing shown on screen):

| Image | Flags | What it shows |
|---|---|---|
| windows-window-options-light.png | `--appearance light` | Open/Close buttons, `getWindowAvailability(option)` for all ten options (`available` on macOS), the first option rows with their initial values. |
| windows-window-options-dark.png | `--appearance dark` | The same in dark. |
| windows-window-options-light-ar.png | `--appearance light --locale ar` | Layout mirrored: sidebar on the right, rows read right to left (Next at the left). Screen strings are English, area names Arabic. |

Child window, `bun e2e/verification/65/capture-child.ts` under `ks-lock native`. It navigates to
`spark-ks://windows/window-options?child=open[&next=…]`, which opens the child with the open-time
options and advances the listed rows, then captures the child with the driver's
`capture` and `id:windows-window-options-child`. Driver mode never puts the child on screen
(docs/test-driver.md). The script also writes a main-window capture; those duplicated the images
above and were not kept.

| Image | Flags | What it shows |
|---|---|---|
| window-options-light-child.png | `--appearance light` | Options applied at open: overlay title bar (transparent, title hidden), traffic lights moved to 20, 18 (they sit over the content), edited dot in the close button. |
| window-options-dark-child.png | `--appearance dark` | The same in dark. The child follows the app appearance. |
| window-options-light-ar-child.png | `--appearance light --locale ar` | The same. `-AppleLanguages (ar)` does not make AppKit lay the title bar out right to left, so the buttons stay on the left; right-to-left title bars are covered by the native test run with `-NSForceRightToLeftWritingDirection YES`. |
| window-options-changed-light-child.png | `--appearance light --name window-options-changed-light --next title-bar,title-bar,title-bar,toolbar,represented-file,traffic-lights,background` | After updates on the live window: default title bar with title and subtitle "Draft", unified toolbar (taller title bar), traffic lights back at AppKit's position, edited dot kept, represented file set without changing the title. The #3366CC background is behind opaque React content, and the proxy icon only appears on hover, so neither shows. |
| window-options-changed-dark-child.png | same, `--appearance dark` | The same in dark. |

Not visible in any in-process capture: level, Spaces, content protection, click-through,
opacity, shadow and behind-window vibrancy are composited by the window server. The native test
(`tests/window.native.mm`) asserts the `NSWindow` (and window-server sharing) state for each.
