# #100 Display details and change events: verification

I opened and checked every image. Mac: 16-inch MacBook Pro (Mac16,5, M4 Max), macOS 27.0 (26A428), one display (built-in Liquid Retina XDR, ProMotion).

## Kitchen Sink screen, real display

From `bun run ks:capture displays-graphics/displays` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). No simulation: these are this Mac's real values.

| Image | Flags | What it shows |
|---|---|---|
| displays-graphics-displays-light.png | `--appearance light` | `{"available":true}`. Built-in Retina Display, primary, id 1: 1728 x 1117 @2x at origin 0,0, work area y 33, safe area top 32 (the notch), refresh `24`-`120` Hz `variable: true`, color space "Color LCD" P3, EDR headroom current 1.2, potential 16, no reference preset. |
| displays-graphics-displays-dark.png | `--appearance dark` | The same in dark. |
| displays-graphics-displays-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left. JSON readouts stay untranslated; the profile name is AppKit's Arabic localization. |

## Driver flows (simulated display source)

From `bun run e2e:run e2e/flows/displays-graphics/<flow>.yaml --backend driver`, which passed 3 times each. `simulateDisplays` replaces what `@legendapp/spark/displays` reports in-process; no display setting of this Mac changed.

| Image | Flow | What it shows |
|---|---|---|
| displays-simulated.png | displays-simulated-info.yaml | Display 901 (modeled on the 14-inch MacBook Pro: notch, 24-120 Hz variable, P3, EDR 16) and 902 (60 Hz fixed, to the right). 903 (1x sRGB, to the left) is below the fold; the flow asserts its fields. |
| displays-change-events.png | displays-change-events.yaml | The screen after eight simulated changes (connect, rearrange, new primary, resolution and scale, fixed 60 Hz, sRGB profile and EDR, unplug): 901 alone and primary again. |
