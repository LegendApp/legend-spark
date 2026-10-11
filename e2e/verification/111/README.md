# #111 Printing, page setup and PDF export: verification

I opened and checked every image.

## Kitchen Sink screen

From `bun run ks:capture document-model/printing` against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). The driver captures app windows, not panels, so these show the screen, not the print or page setup panels.

| Image | Flags | What it shows |
|---|---|---|
| document-model-printing-light.png | `--appearance light` | Availability: printing, print panel, page setup and PDF export `{"available":true}`. The page setup (A4 · Portrait · margins 54/54/54/54 pt, the app default), its two actions, the white receipt card that "Print receipt card…" prints, the print triggers and the export trigger. |
| document-model-printing-dark.png | `--appearance dark` | The same in dark. The receipt card stays white: it is the paper-like View printed by ref. |
| document-model-printing-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left. JSON readouts stay untranslated. |

## PDFs exported by the app, headless

From `bun run e2e:run e2e/flows/document-model/printing-pdf-export-driver.yaml --backend driver` (passed). The app launched in driver mode with `--ks-print-export <folder>` and called `exportPDF` three times with A4 portrait, 54-point margins. PDFKit read back: report.pdf 3 pages, window.pdf 1 page, card.pdf 1 page, every page 595.28 x 841.89 points, Title "Quarterly report". First pages rendered to PNG at 2x on white:

| Image | What it shows |
|---|---|
| exported-report-page1.png | The HTML report reflowed into the 54-point margins: heading, intro, the sales table and the first sections; the text continues on page 2. |
| exported-window-page1.png | The main window's content (sidebar and Printing screen) as drawn, scaled down to the 487-point column, centered at the top. |
| exported-card-page1.png | Only the receipt card View, found by its ref, at its own size (narrower than the column, so not scaled), centered at the top. |
| driver-printing-exported.png | The driver's capture after the exports: the export result JSON and one marker per file (report 3 pages, window and card 1 page, 595 × 842 pt). The OS was in dark mode. |

## Native harness exports

From `SPARK_PRINTING_RENDER_DIR=$PWD/e2e/verification/111 bun run test tests/printing-native.test.ts` (the real `SparkPrinting.mm`, no app):

| Image | What it shows |
|---|---|
| native-text-page1.png | Plain text on US Letter with 72-point margins: lines 1–43 of 150, black, inside the margins. |
| native-html-page1.png | HTML on A4 landscape (842 x 595) with uneven margins (36/54/72/18), exported while the app appearance was dark: text without a color is still black. |
| native-window-page1.png | A window that was never shown: its layer-backed red view and drawRect text, both printed (NSView printing would have dropped the layer color). |
