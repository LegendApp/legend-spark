# #123 Dock badge and progress: verification

I opened and checked every image.

## Kitchen Sink screen

From `bun run ks:capture system-integration/dock` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). The driver captures the app window only; a driven app has no Dock icon, so badge and progress never reach the Dock.

The approved goldens are the captures:

| Golden | Flags | What it shows |
|---|---|---|
| [light, English](../../golden/macos/light/en/system-integration-dock.png) | `--appearance light` | Availability: system, appBadge, appProgress, attention and dockMenu `{"available":true}`; taskbarMenu `unsupported-platform`. Badge, progress and attention triggers; results read `—` until run. |
| [dark, English](../../golden/macos/dark/en/system-integration-dock.png) | `--appearance dark` | The same in dark. |
| [light, Arabic](../../golden/macos/light/ar/system-integration-dock.png) | `--appearance light --locale ar` | Arabic labels, laid out right to left. JSON readouts stay untranslated. |

## Dock tile progress, rendered offscreen

From `SPARK_DOCK_RENDER_DIR=$PWD/e2e/verification/123 bun run test tests/dock-tile-native.test.ts`. The harness renders the real `SparkDockProgressView` (packages/system/macos/SparkDockTile.mm) with `cacheDisplayInRect` at 2x in a process with no bundle and a prohibited activation policy, so it has no Dock icon and nothing reaches the Dock.

| Image | What it shows |
|---|---|
| dock-tile-progress-light.png | Left to right: cleared (the plain icon), 0%, 35%, 100%, indeterminate (static stripes), paused 60% (yellow), error 80% (red), and 35% right to left (fills from the right). Light track. |
| dock-tile-progress-dark.png | The same states in dark, with a dark track (no RTL tile). |
