# #52 in-app capture: verification

Each image came from `bun run ks:capture` against the Kitchen Sink dev build (driver mode, no window shown, no focus taken). I opened and checked every one.

| Image | Command | What it shows |
|---|---|---|
| catalog-light.png | `--wait-for infra-shell-root --appearance light` | Launch catalog, light. |
| catalog-dark.png | `--wait-for infra-shell-root --appearance dark` | The same, dark. |
| catalog-ar-dark.png | `--appearance dark --locale ar` | Arabic RTL. The shell mirrors correctly, but **content inside scroll views renders mirrored**: a real react-native-macos bug, filed as #234. |
| native-controls-toggles-light.png | `native-controls/toggles` | Navigated via `spark-ks://`, waited for the root testID. Disclosure triangles render "›…", filed as #235. |
