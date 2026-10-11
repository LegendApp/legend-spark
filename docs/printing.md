# Printing, page setup and PDF export

`@legendapp/spark/printing` prints content through the system print panel (with a live
preview), shows the page setup panel, and exports the same pages to a PDF file without any UI.

```ts
import { exportPDF, getPrintingAvailability, paperSizes, print, showPageSetup, type PageSetup } from '@legendapp/spark/printing';

const setup: PageSetup = { paperSize: paperSizes.a4, orientation: 'portrait', margins: { top: 54, right: 54, bottom: 54, left: 54 } };
const report = { type: 'html', html: '<h1>Quarterly report</h1><p>…</p>' } as const;

const printed = await print(report, { pageSetup: setup, windowId: 'main', title: 'Quarterly report' });
if (!printed.canceled) saveSetup(printed.pageSetup); // The panel may have changed paper or orientation.

const changed = await showPageSetup({ pageSetup: setup, windowId: 'main' });
const { numberOfPages } = await exportPDF(report, '/Users/me/Desktop/Report.pdf', { pageSetup: setup });
```

## Content

```ts
type PrintContent =
  | { type: 'text'; text: string }        // 12 pt system font, black
  | { type: 'html'; html: string }        // AppKit's HTML importer (NSAttributedString)
  | { type: 'pdf'; path: string }         // An existing PDF; each page scaled to fit a sheet
  | { type: 'window'; windowId: string }  // What the window's content view draws now
  | { type: 'view'; view: PrintableView } // What one mounted View draws now (a ref)
```

Documents and live UI need different treatment, so both are first class:

- **Text and HTML reflow** into the printable area (the paper minus its margins), one text
  container per page, so lines never split across pages and changing the paper in the print
  panel re-paginates. HTML is the way to send styled, localized text (`<html dir="rtl">` for
  right-to-left). Text without an explicit color prints black, whatever the app's appearance.
  The importer may load resources the HTML references; it waits at most 10 seconds.
- **PDF documents** keep their own layout: each source page is scaled to fit one sheet,
  centered, honoring the page's rotation.
- **Windows and views print what they draw now.** AppKit's NSView printing skips Core
  Animation layer content (React Native backgrounds, borders and images are layer content), so
  Spark renders the view with `cacheDisplayInRect:` at the window's backing scale, the same path
  the test driver uses for captures (it draws layer colors, layer images, text and controls). The
  image is scaled down to the page width when it is wider, centered, and continues onto further
  pages when it is taller. It is a raster image of the current appearance: a dark window prints
  dark. Use text, HTML or a PDF for paper-friendly or long documents.
- A `view` is a ref to a mounted host `View`. Give it `collapsable={false}`; otherwise React
  Native may flatten it away and the call rejects `E_NOT_FOUND`.

## Page setup

```ts
interface PageSetup {
  paperSize: { width: number; height: number };              // points, the portrait sheet: width <= height
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number }; // points, of the oriented page
}
```

All values are points (1/72 inch). `paperSizes` holds common sheets (Letter, Legal, Tabloid, A3,
A4, A5). A page setup is plain JSON: the caller decides where it lives, for example in each
document's metadata or once per app in a settings store. Spark keeps no hidden page setup state;
every call takes the setup to use.

- `showPageSetup({ pageSetup?, windowId? })` shows the macOS page setup panel (paper and
  orientation; it has no margins, so the given margins come back unchanged) and resolves
  `{ canceled: true }` or `{ canceled: false, pageSetup }`.
- `getDefaultPageSetup()` returns the system's setup: the default printer's paper and AppKit's
  default margins. It differs between machines, so pass an explicit setup where output must be
  repeatable.
- Validation: paper sides from 1 to 14,400 points (the largest PDF page), `width <= height`,
  margins of 0 or more that leave at least 72 points of printable width and height.
- AppKit snaps a sheet to the nearest paper of the current printer, or of its generic list on a
  Mac without printers (there A4 is 595 x 842). A sheet within 1 point of the one passed in reads
  back exactly as passed, so a setup round-trips the same with or without printers; other values
  read from AppKit are rounded to 0.01 point. The orientation follows the sheet's shape. Printing
  uses the snapped paper; `exportPDF` uses the exact values.

## Printing

`print(content, { pageSetup?, windowId?, title? })` shows the print panel with a live preview,
copies, page range, paper size, orientation and scale. With `windowId` the panel is a sheet on
that window; otherwise it is application-modal. `title` names the print job and the file when
the user saves as PDF from the panel.

| Outcome | Result |
| --- | --- |
| Printed (or saved through the panel's PDF menu) | `{ canceled: false, pageSetup }`, the setup the panel settled on |
| Canceled | `{ canceled: true }` |
| Failed | Rejects with a `SparkError` (below) |

AppKit's `runOperation` returns NO both when the panel is canceled and when the job fails.
Spark treats an unsuccessful run whose job disposition is `NSPrintCancelJob` as canceled, and
any other unsuccessful run as a failure (`E_NATIVE`).

Cancellation is an expected result and failures reject, as for every Spark command
([API conventions](api-contracts.md#3-shared-api-conventions)). One print or page setup panel
runs at a time (`E_BUSY`), and a window that already shows a sheet rejects `E_BUSY`.

## PDF export

`exportPDF(content, path, { pageSetup?, title? })` lays out the same pages as `print` and draws
them straight into a PDF (Core Graphics), then writes it atomically to `path`, replacing a file
there. It never shows UI and never involves the printing system, so it works headless: in the
test driver, in tests and from agents. It resolves `{ path, numberOfPages, pageSetup }`.
`title` becomes the PDF's Title metadata.

Spark does not export through `NSPrintOperation` with a save-to-file job disposition: when that
destination cannot be written, AppKit can send the job to the default printer instead.
`PDFOperationWithView:` does not paginate. The direct render has neither problem, and the print
panel previews pages laid out by the same code.

## Errors and availability

| Code | When |
| --- | --- |
| `E_INVALID_ARGUMENT` | Bad content, page setup, window ID, title or path (before any native call) |
| `E_UNSUPPORTED_OPTION` | An unknown key in options, content or the page setup |
| `E_NOT_FOUND` | The window, view, PDF or the export's folder does not exist |
| `E_INVALID_DATA` | Unreadable HTML or PDF, a PDF without pages, or a view with no size |
| `E_PERMISSION_DENIED` | A password-locked PDF, or the export path is not writable |
| `E_ALREADY_EXISTS` | A folder is at the export path |
| `E_BUSY` | A print or page setup panel is open, or the owner window has a sheet |
| `E_NATIVE` | The print job did not complete, or another write failure |
| `E_UNSUPPORTED_PLATFORM` / `E_MODULE_UNAVAILABLE` | Not macOS, or the native module is missing |

`getPrintingAvailability(feature?)` takes `"printPanel"`, `"pageSetup"` or `"pdfExport"`. All
are available on macOS 14 and later with the module installed. On Windows every feature reports
`unsupported-platform` and the operations reject `E_UNSUPPORTED_PLATFORM` after validating their
arguments; the Windows implementation is tracked in
[#275](https://github.com/LegendApp/legend-spark/issues/275).

## Relationship to Expo

Spark owns this contract. It borrows `expo-print`'s vocabulary where the meaning matches
(`orientation: 'portrait' | 'landscape'`, `margins`, `numberOfPages`), but not its behavior:
Expo prints HTML or a URI only, writes `printToFileAsync` output to a cache file, and has no
page setup panel or window/view content.

## Verification

- `tests/printing.test.ts`: validation, wire shapes, results, error codes and availability
  against a mocked bridge.
- `tests/printing-native.test.ts` compiles `tests/printing.native.mm` with the real
  `packages/printing/macos/SparkPrinting.mm`: page setup round trips, print operations configured
  but never run (their pagination matches the export), and real exports parsed back with PDFKit
  (page count, page sizes, text, and rendered pixels for margins, dark-appearance text and layer
  colors).
- Kitchen Sink: Document model > Printing (`spark-ks://document-model/printing`). Launching with
  `--ks-print-export <path>` exports the report on start, because the driver backend cannot click
  yet; `e2e/flows/document-model/printing-pdf-export-driver.yaml` uses it.
