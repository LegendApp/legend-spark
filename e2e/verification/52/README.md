# #52 in-app capture: verification

Each image came from `bun run ks:capture` against the Kitchen Sink dev build (driver mode, no window shown, no focus taken). I opened and checked every one.

| Image | Command | What it shows |
|---|---|---|
| catalog-light.png | `--wait-for infra-shell-root --appearance light` | Launch catalog, light. |
| catalog-dark.png | `--wait-for infra-shell-root --appearance dark` | The same, dark. |
| catalog-ar-dark.png | `--appearance dark --locale ar` | Arabic RTL. The shell mirrors correctly, but **content inside scroll views renders mirrored**: a real react-native-macos bug, filed as #234. |
| native-controls-toggles-light.png | `native-controls/toggles` | Navigated via `spark-ks://`, waited for the root testID. Disclosure triangles render "›…", filed as #235. |

## Virtual clock, motion telemetry, frame counters

`e2e/flows/motion-system/telemetry-driver.yaml` on the Kitchen Sink dev build, driver backend: with the virtual
clock frozen, Play presets, then `assertMotion` with `frames: { at: [0, 25, 50, 100] }` on the bouncy box. Each
frame is the window at that percent of the bouncy spring's motion (1210 ms): at 0% all boxes are at the start; at
25% bouncy is past the end of its track (its overshoot) while the others are still on the way; at 50% all are near
the end; at 100% all rest at the end. The approved goldens are
`e2e/golden/macos/light/en/springs-bouncy-{0,25,50,100}.png`; a second run matched them exactly.
