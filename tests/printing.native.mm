// Drives the real SparkPrinting core (packages/printing/macos) headlessly: page setup round trips,
// print operations configured but never run, and real PDF exports parsed back with PDFKit.
// Nothing is presented and nothing reaches the printing system: exports render straight to PDF.
#import <PDFKit/PDFKit.h>
#import "SparkPrinting.h"

static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)
static BOOL Near(double a, double b) { return fabs(a - b) < 0.01; }
static BOOL NearRect(NSRect a, NSRect b) { return Near(a.origin.x, b.origin.x) && Near(a.origin.y, b.origin.y) && Near(a.size.width, b.size.width) && Near(a.size.height, b.size.height); }

static NSDictionary *Setup(double width, double height, NSString *orientation, double top, double right, double bottom, double left) {
  return @{ @"paperSize": @{ @"width": @(width), @"height": @(height) }, @"orientation": orientation, @"margins": @{ @"top": @(top), @"right": @(right), @"bottom": @(bottom), @"left": @(left) } };
}
static SparkPrintFailure Unexpected(void) { return ^(NSString *code, NSString *message) { fprintf(stderr, "UNEXPECTED %s: %s\n", code.UTF8String, message.UTF8String); failures++; }; }
static NSString *FailureCode(SparkPrintView * (^make)(SparkPrintFailure)) {
  __block NSString *result = nil;
  make(^(NSString *code, NSString *message) { result = code; });
  return result;
}

// Exports, then checks the file independently with PDFKit: page count and every page's media box.
static PDFDocument *Export(SparkPrintView *view, NSDictionary *setup, NSString *path, NSInteger *pages) {
  *pages = SparkExportPDF(view, setup, path, @"Spark printing test", Unexpected());
  PDFDocument *pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
  CHECK(pdf != nil);
  CHECK(pdf.pageCount == *pages);
  BOOL landscape = [setup[@"orientation"] isEqual:@"landscape"];
  double width = [setup[@"paperSize"][@"width"] doubleValue], height = [setup[@"paperSize"][@"height"] doubleValue];
  for (NSInteger index = 0; index < pdf.pageCount; index++) {
    NSRect box = [[pdf pageAtIndex:index] boundsForBox:kPDFDisplayBoxMediaBox];
    CHECK(Near(box.size.width, landscape ? height : width) && Near(box.size.height, landscape ? width : height));
  }
  CHECK([pdf.documentAttributes[PDFDocumentTitleAttribute] isEqual:@"Spark printing test"]);
  return pdf;
}

// Renders a PDF page at 1 pixel per point on white, as a viewer would show it.
static NSBitmapImageRep *Rasterize(PDFPage *page) {
  NSRect box = [page boundsForBox:kPDFDisplayBoxMediaBox];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)box.size.width pixelsHigh:(NSInteger)box.size.height bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  CGContextSetFillColorWithColor(context.CGContext, NSColor.whiteColor.CGColor);
  CGContextFillRect(context.CGContext, CGRectMake(0, 0, box.size.width, box.size.height));
  [page drawWithBox:kPDFDisplayBoxMediaBox toContext:context.CGContext];
  [context flushGraphics];
  return rep;
}
// Pixel at x, y points from the page's top-left.
static NSColor *Pixel(NSBitmapImageRep *rep, NSInteger x, NSInteger y) { return [[rep colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace]; }
static BOOL Dark(NSColor *color) { return color.redComponent < 0.35 && color.greenComponent < 0.35 && color.blueComponent < 0.35; }
static BOOL Red(NSColor *color) { return color.redComponent > 0.8 && color.greenComponent < 0.3 && color.blueComponent < 0.3; }
static BOOL InkBetween(NSBitmapImageRep *rep, NSInteger x0, NSInteger x1, NSInteger y0, NSInteger y1) {
  for (NSInteger y = y0; y < y1; y++) for (NSInteger x = x0; x < x1; x++) if (Dark(Pixel(rep, x, y))) return YES;
  return NO;
}

@interface Label : NSView @end
@implementation Label
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirty { [@"Rendered text" drawAtPoint:NSMakePoint(4, 4) withAttributes:@{ NSFontAttributeName: [NSFont boldSystemFontOfSize:20], NSForegroundColorAttributeName: NSColor.blackColor }]; }
@end

int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  NSString *output = argc > 1 ? @(argv[1]) : nil;
  NSString *directory = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-printing-%d", getpid()]];
  [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *(^file)(NSString *) = ^(NSString *name) { return [directory stringByAppendingPathComponent:name]; };

  // Page setup round trips exactly, whatever printers are installed. AppKit snaps the sheet to the
  // current printer's paper list, or to its generic list on a Mac without printers (A4 becomes
  // 595 x 842 there, 595.28 x 841.89 with a printer), so NSPrintInfo is only checked to the point.
  NSDictionary *a4Landscape = Setup(595.28, 841.89, @"landscape", 36, 54, 72, 18);
  NSPrintInfo *info = SparkPrintInfo(a4Landscape);
  CHECK(info.orientation == NSPaperOrientationLandscape);
  CHECK(fabs(info.paperSize.width - 841.89) <= 1 && fabs(info.paperSize.height - 595.28) <= 1);
  CHECK(info.topMargin == 36 && info.rightMargin == 54 && info.bottomMargin == 72 && info.leftMargin == 18);
  CHECK(!info.horizontallyCentered && !info.verticallyCentered);
  CHECK([SparkPageSetup(info, a4Landscape) isEqual:a4Landscape]);
  // The generic list's A4 asked for on a Mac whose printer has 595.28 x 841.89: the same normalization.
  NSDictionary *genericA4 = Setup(595, 842, @"portrait", 54, 54, 54, 54);
  CHECK([SparkPageSetup(SparkPrintInfo(genericA4), genericA4) isEqual:genericA4]);
  for (NSDictionary *setup in @[Setup(288, 432, @"portrait", 9, 9, 9, 9), Setup(288, 432, @"landscape", 9, 9, 9, 9), Setup(300, 500, @"landscape", 18, 18, 18, 18), Setup(612, 792, @"landscape", 72, 72, 72, 72)]) {
    NSDictionary *read = SparkPageSetup(SparkPrintInfo(setup), setup);
    if (![read isEqual:setup]) fprintf(stderr, "ROUND TRIP %s -> %s\n", setup.description.UTF8String, read.description.UTF8String);
    CHECK([read isEqual:setup]);
  }
  // Without a requested setup (the panels' results) the values are AppKit's, rounded to 0.01 point,
  // and the orientation follows the sheet's shape.
  NSDictionary *read = SparkPageSetup(info, nil);
  CHECK([read[@"orientation"] isEqual:@"landscape"] && [read[@"margins"] isEqual:a4Landscape[@"margins"]]);
  CHECK(fabs([read[@"paperSize"][@"width"] doubleValue] - 595.28) <= 1 && fabs([read[@"paperSize"][@"height"] doubleValue] - 841.89) <= 1);
  NSDictionary *defaults = SparkPageSetup(SparkPrintInfo(nil), nil);
  CHECK([defaults[@"paperSize"][@"width"] doubleValue] > 0 && [defaults[@"paperSize"][@"width"] doubleValue] <= [defaults[@"paperSize"][@"height"] doubleValue]);

  // Plain text on US Letter: several pages, each 612 x 792, text inside the margins only.
  NSMutableString *text = [NSMutableString new];
  for (int line = 1; line <= 150; line++) [text appendFormat:@"Line %d of the printing test document.\n", line];
  NSDictionary *letter = Setup(612, 792, @"portrait", 72, 72, 72, 72);
  SparkPrintView *textView = [SparkPrintView viewWithContent:@{ @"type": @"text", @"text": text } failure:Unexpected()];
  NSInteger textPages = 0;
  PDFDocument *textPDF = Export(textView, letter, file(@"text.pdf"), &textPages);
  CHECK(textPages >= 3);
  CHECK([[textPDF pageAtIndex:0].string hasPrefix:@"Line 1 of the printing test document."]);
  CHECK([textPDF.string containsString:@"Line 150 of the printing test document."]);
  NSBitmapImageRep *textPage = Rasterize([textPDF pageAtIndex:0]);
  CHECK(InkBetween(textPage, 72, 300, 72, 100));    // The first line, at the top-left margin.
  CHECK(!InkBetween(textPage, 0, 612, 0, 70));      // Nothing in the top margin.
  CHECK(!InkBetween(textPage, 0, 70, 0, 792));      // Nothing in the left margin.

  // The same view as a print operation: configured with the panel and preview, never run.
  NSPrintOperation *operation = SparkPrintOperation(textView, letter, @"Printing test");
  CHECK(operation.showsPrintPanel && [operation.jobTitle isEqual:@"Printing test"]);
  CHECK((operation.printPanel.options & (NSPrintPanelShowsPreview | NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation)) == (NSPrintPanelShowsPreview | NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation));
  CHECK(fabs(operation.printInfo.paperSize.width - 612) <= 1 && operation.printInfo.topMargin == 72);
  [NSPrintOperation setCurrentOperation:operation];
  NSRange range = NSMakeRange(0, 0);
  CHECK([textView knowsPageRange:&range]);
  CHECK(range.location == 1 && (NSInteger)range.length == textPages); // Print pagination matches the export.
  CHECK(NearRect([textView rectForPage:2], NSMakeRect(0, 648, 468, 648)));
  operation.printInfo.orientation = NSPaperOrientationLandscape;   // As if the panel changed orientation.
  CHECK([textView knowsPageRange:&range] && (NSInteger)range.length > textPages);
  operation.printInfo.scalingFactor = 0.5;                          // As if the panel scaled to 50%.
  CHECK([textView knowsPageRange:&range] && NearRect([textView rectForPage:1], NSMakeRect(0, 0, 1296, 936)));
  [NSPrintOperation setCurrentOperation:nil];

  // HTML in landscape A4, while the app is dark: text without a color still prints dark on white.
  NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  NSMutableString *html = [@"<h1>Quarterly report</h1>" mutableCopy];
  for (int paragraph = 1; paragraph <= 60; paragraph++) [html appendFormat:@"<p>Paragraph %d of the report.</p>", paragraph];
  SparkPrintView *htmlView = [SparkPrintView viewWithContent:@{ @"type": @"html", @"html": html } failure:Unexpected()];
  NSInteger htmlPages = 0;
  PDFDocument *htmlPDF = Export(htmlView, a4Landscape, file(@"html.pdf"), &htmlPages);
  CHECK(htmlPages >= 2);
  CHECK([[htmlPDF pageAtIndex:0].string hasPrefix:@"Quarterly report"]);
  CHECK(InkBetween(Rasterize([htmlPDF pageAtIndex:0]), 18, 400, 36, 80)); // The heading, dark, at the margins.
  NSApp.appearance = nil;

  // A PDF document: every source page becomes a page of the requested paper.
  SparkPrintView *pdfView = [SparkPrintView viewWithContent:@{ @"type": @"pdf", @"path": file(@"text.pdf") } failure:Unexpected()];
  NSInteger pdfPages = 0;
  PDFDocument *reprinted = Export(pdfView, a4Landscape, file(@"reprinted.pdf"), &pdfPages);
  CHECK(pdfPages == textPages);
  CHECK([[reprinted pageAtIndex:0].string hasPrefix:@"Line 1 of the printing test document."]);

  // A window that was never shown, and one of its views: layer colors and drawn text both print.
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  window.releasedWhenClosed = NO;
  window.identifier = @"spark.printing-test";
  window.contentView.wantsLayer = YES;
  window.contentView.layer.backgroundColor = NSColor.whiteColor.CGColor;
  NSView *swatch = [[NSView alloc] initWithFrame:NSMakeRect(20, 20, 160, 100)];
  swatch.wantsLayer = YES;
  swatch.layer.backgroundColor = NSColor.redColor.CGColor;
  [window.contentView addSubview:swatch];
  Label *caption = [[Label alloc] initWithFrame:NSMakeRect(200, 240, 180, 40)];
  [window.contentView addSubview:caption];
  SparkPrintView *windowView = [SparkPrintView viewWithContent:@{ @"type": @"window", @"windowId": @"printing-test" } failure:Unexpected()];
  NSInteger windowPages = 0;
  PDFDocument *windowPDF = Export(windowView, letter, file(@"window.pdf"), &windowPages);
  CHECK(windowPages == 1);
  NSBitmapImageRep *windowPage = Rasterize([windowPDF pageAtIndex:0]);
  // 400 x 300 fits the 468-point column, centered: the window's top-left lands at (106, 72).
  CHECK(Red(Pixel(windowPage, 106 + 100, 72 + 300 - 70)));  // The layer-backed swatch (y-up frame 20..120).
  CHECK(!Red(Pixel(windowPage, 106 + 300, 72 + 150)));
  CHECK(InkBetween(windowPage, 106 + 200, 106 + 380, 72 + 20, 72 + 60)); // The drawRect text.
  NSInteger swatchPages = 0;
  PDFDocument *swatchPDF = Export([SparkPrintView viewWithSnapshotOf:swatch failure:Unexpected()], Setup(288, 432, @"landscape", 18, 18, 18, 18), file(@"swatch.pdf"), &swatchPages);
  CHECK(swatchPages == 1 && Red(Pixel(Rasterize([swatchPDF pageAtIndex:0]), 216, 68)));
  // A view wider than the column is scaled down to its width; a tall one continues on the next page.
  NSView *poster = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 936, 2000)];
  poster.wantsLayer = YES;
  poster.layer.backgroundColor = NSColor.redColor.CGColor;
  NSInteger posterPages = 0;
  PDFDocument *posterPDF = Export([SparkPrintView viewWithSnapshotOf:poster failure:Unexpected()], letter, file(@"poster.pdf"), &posterPages);
  CHECK(posterPages == 2); // 2000 points at 0.5 = 1000, over a 648-point column.
  NSBitmapImageRep *posterPage = Rasterize([posterPDF pageAtIndex:1]);
  CHECK(Red(Pixel(posterPage, 80, 100)) && !Red(Pixel(posterPage, 80, 500)));

  // Typed failures.
  CHECK([FailureCode(^(SparkPrintFailure f) { return [SparkPrintView viewWithContent:@{ @"type": @"pdf", @"path": file(@"missing.pdf") } failure:f]; }) isEqual:@"E_NOT_FOUND"]);
  [@"not a pdf" writeToFile:file(@"fake.pdf") atomically:YES encoding:NSUTF8StringEncoding error:nil];
  CHECK([FailureCode(^(SparkPrintFailure f) { return [SparkPrintView viewWithContent:@{ @"type": @"pdf", @"path": file(@"fake.pdf") } failure:f]; }) isEqual:@"E_INVALID_DATA"]);
  CHECK([FailureCode(^(SparkPrintFailure f) { return [SparkPrintView viewWithContent:@{ @"type": @"window", @"windowId": @"missing" } failure:f]; }) isEqual:@"E_NOT_FOUND"]);
  CHECK([FailureCode(^(SparkPrintFailure f) { return [SparkPrintView viewWithSnapshotOf:[[NSView alloc] initWithFrame:NSZeroRect] failure:f]; }) isEqual:@"E_INVALID_DATA"]);
  __block NSString *code = nil;
  SparkPrintFailure capture = ^(NSString *value, NSString *message) { code = value; };
  CHECK(SparkExportPDF(textView, letter, file(@"missing-folder/out.pdf"), nil, capture) == 0 && [code isEqual:@"E_NOT_FOUND"]);
  CHECK(SparkExportPDF(textView, letter, directory, nil, capture) == 0 && [code isEqual:@"E_ALREADY_EXISTS"]);
  // Export replaces an existing file atomically.
  CHECK(SparkExportPDF(textView, letter, file(@"replaced.pdf"), nil, Unexpected()) == textPages);
  CHECK(SparkExportPDF(windowView, letter, file(@"replaced.pdf"), nil, Unexpected()) == 1 && [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:file(@"replaced.pdf")]].pageCount == 1);

  // Nothing was presented.
  for (NSWindow *candidate in NSApp.windows) CHECK(!candidate.visible);

  if (output) for (NSString *name in @[@"text", @"html", @"window"]) {
    PDFDocument *pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:file([name stringByAppendingPathExtension:@"pdf"])]];
    [[Rasterize([pdf pageAtIndex:0]) representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[output stringByAppendingPathComponent:[NSString stringWithFormat:@"native-%@-page1.png", name]] atomically:YES];
  }
  [NSFileManager.defaultManager removeItemAtPath:directory error:nil];
  if (failures) { fprintf(stderr, "%d printing checks failed\n", failures); return 1; }
  printf("Printing native tests passed\n");
  return 0;
}}
