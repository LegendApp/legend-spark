# #245 macOS RTL text alignment: verification

Each image came from `bun run ks:capture` against the Kitchen Sink dev build (driver mode, no window shown, no focus taken). I opened and checked every one.

| Image | Build | What it shows |
|---|---|---|
| before-text-alignment-light-ar.png | unpatched | `internationalization/text-alignment`: no `textAlign` and `"auto"` align left. `"left"` aligns right and `"right"` aligns left, so the RTL layout direction does reach the text attributes; only natural alignment ignores it. |
| internationalization-text-alignment-light-ar.png, -dark-ar.png | patched | No `textAlign` and `"auto"` align right (the leading edge). `"left"` and `"right"` are unchanged. |
| internationalization-text-alignment-light-en.png | patched | LTR is unchanged: byte-identical to the unpatched capture. |
| catalog-light-ar.png, catalog-dark-ar.png | patched | Area headings, the summary line, card text and sidebar labels align right. |
| internationalization-scroll-direction-light-ar.png, -dark-ar.png | patched | The hint and the month cards' text align right; the strip still starts at its right edge (#234). |
| catalog-light-en.png, catalog-dark-en.png, internationalization-scroll-direction-light-en.png | patched | LTR text aligns left, as before. |

The before image came from the unpatched build. Every other image came from the patched build after rebasing onto #248, with the saved window frame deleted from the shared user defaults, so they're at the configured 1000x700.
