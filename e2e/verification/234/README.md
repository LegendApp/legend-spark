# #234 macOS RTL ScrollView: verification

Each image came from `bun run ks:capture` against the Kitchen Sink dev build (driver mode, no window shown, no focus taken). I opened and checked every one.

| Image | Build | What it shows |
|---|---|---|
| before-catalog-light-ar.png | unpatched | Arabic catalog: sidebar list and catalog content (both scroll views) render mirrored. |
| before-scroll-direction-light-ar.png | unpatched | `internationalization/scroll-direction`: the month strip is mirrored (glyphs reversed, month 1 at the left). |
| catalog-light-ar.png, catalog-dark-ar.png | patched | Scroll content reads correctly; RTL layout stays mirrored (sidebar on the right, counts at the row's end). |
| internationalization-scroll-direction-light-ar.png, -dark-ar.png | patched | The horizontal strip starts at its right (RTL leading) edge with month 1; text reads correctly. |
| catalog-light-en.png, internationalization-scroll-direction-light-en.png | patched | LTR is unchanged: month 1 at the left, strip at offset 0. |
