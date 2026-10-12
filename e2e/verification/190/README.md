# #190 special window types: captures

All captures are in-process driver renders (`ks:capture`, and `takeScreenshot` in the flows run with
`bun run e2e:run … --backend driver`); no window was shown on screen. Behind-window vibrancy renders as flat
gray in driver captures (docs/test-driver.md).

| File | What |
|---|---|
| `multiwindow-special-windows-light.png`, `-dark.png`, `-light-ar.png` | The screen at rest (`ks:capture multiwindow/special-windows`) |
| `special-windows-bar-shown-light.png`, `-dark-ar.png` | The screen after the command bar's hotkey (`special-command-bar-hud.yaml`), on simulated display 901 |
| `command-bar-light.png`, `command-bar-dark.png` | The command bar window |
| `hud-light.png` | The HUD window |
| `preview.png` | The preview window (HUD panel chrome) |
| `picture-in-picture.png`, `popover.png`, `edge-drawer.png`, `desktop-widget.png` | Those windows (`special-placement.yaml`) |
| `presenter-audience.png` | The presenter audience window on simulated display 902 (`special-presenter.yaml`) |
