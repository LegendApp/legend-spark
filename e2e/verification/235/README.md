# #235 DisclosureTriangle: verification

Each image came from `bun run ks:capture native-controls/toggles` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). I opened and checked every one.

| Image | Flags | What it shows |
|---|---|---|
| native-controls-toggles-light.png | `--appearance light` | Bottom row: a plain disclosure triangle (›) at the leading edge of every size, no "…". Compare `e2e/verification/52/native-controls-toggles-light.png`. |
| native-controls-toggles-dark.png | `--appearance dark` | The same in dark. |
| native-controls-toggles-light-ar.png | `--appearance light --locale ar` | Scroll view content is mirrored by #234, so text reads backwards. Flipping the image horizontally undoes it: the triangles point left (‹) at the right (leading) edge of each column, as RTL expects. |
