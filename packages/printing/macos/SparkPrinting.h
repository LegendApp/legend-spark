// Printing and PDF export without React Native, so native tests can drive them directly.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN
typedef void (^SparkPrintFailure)(NSString *code, NSString *message);

/// Paper-ready content laid out as pages stacked top to bottom: text, HTML, a PDF document or
/// a snapshot of a rendered view. NSPrintOperation prints it, and SparkExportPDF renders the
/// same pages straight into a PDF.
@interface SparkPrintView : NSView
/// { type: "text", text } | { type: "html", html } | { type: "pdf", path } | { type: "window", windowId }.
+ (nullable instancetype)viewWithContent:(NSDictionary *)content failure:(SparkPrintFailure)failure;
/// What the view draws now (layer colors, images, text and controls), scaled down to the page width when wider.
+ (nullable instancetype)viewWithSnapshotOf:(NSView *)view failure:(SparkPrintFailure)failure;
/// Lays out pages of `size` points (the paper minus its margins) and returns how many there are.
- (NSInteger)layoutPagesOfSize:(NSSize)size;
@end

/// A copy of the shared print info with `pageSetup` ({ paperSize, orientation, margins } in points) applied.
FOUNDATION_EXPORT NSPrintInfo *SparkPrintInfo(NSDictionary *_Nullable pageSetup);
/// A print operation for `view` that shows the print panel with a live preview, paper size, orientation and scale.
FOUNDATION_EXPORT NSPrintOperation *SparkPrintOperation(SparkPrintView *view, NSDictionary *_Nullable pageSetup, NSString *_Nullable jobTitle);
/// The page setup of `info`; paperSize is the portrait sheet (width <= height).
FOUNDATION_EXPORT NSDictionary *SparkPageSetup(NSPrintInfo *info);
/// Renders every page into a PDF at `path` (atomically replacing a file) without the printing system,
/// so it never shows UI or reaches a printer. Returns the page count, or 0 after calling failure.
FOUNDATION_EXPORT NSInteger SparkExportPDF(SparkPrintView *view, NSDictionary *pageSetup, NSString *path, NSString *_Nullable title, SparkPrintFailure failure);
/// The window with identifier `id` or `spark.<id>`.
FOUNDATION_EXPORT NSWindow *_Nullable SparkPrintWindow(NSString *windowId);
NS_ASSUME_NONNULL_END
