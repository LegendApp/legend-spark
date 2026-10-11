#import "SparkPrinting.h"
#import <PDFKit/PDFKit.h>

@implementation SparkPrintView {
  NSLayoutManager *_layout; // Text and HTML: one text container per page.
  NSTextStorage *_text;
  NSImage *_image;          // A view snapshot, drawn from the top of the first page.
  PDFDocument *_pdf;        // One source page per page, scaled to fit.
  NSSize _page;
  NSInteger _count;
}

- (BOOL)isFlipped { return YES; }

- (instancetype)initWithText:(NSAttributedString *)text
{
  if ((self = [super initWithFrame:NSZeroRect])) {
    _text = [[NSTextStorage alloc] initWithAttributedString:text];
    _layout = [NSLayoutManager new];
    [_text addLayoutManager:_layout];
  }
  return self;
}

+ (instancetype)viewWithContent:(NSDictionary *)content failure:(SparkPrintFailure)failure
{
  NSString *type = content[@"type"];
  SparkPrintView *view = nil;
  if ([type isEqual:@"text"]) {
    view = [[self alloc] initWithText:[[NSAttributedString alloc] initWithString:content[@"text"] attributes:@{ NSFontAttributeName: [NSFont systemFontOfSize:12], NSForegroundColorAttributeName: NSColor.blackColor }]];
  } else if ([type isEqual:@"html"]) {
    NSData *data = [content[@"html"] dataUsingEncoding:NSUTF8StringEncoding];
    NSAttributedString *text = [[NSAttributedString alloc] initWithData:data options:@{ NSDocumentTypeDocumentOption: NSHTMLTextDocumentType, NSCharacterEncodingDocumentOption: @(NSUTF8StringEncoding), NSTimeoutDocumentOption: @10 } documentAttributes:nil error:nil];
    if (!text) { failure(@"E_INVALID_DATA", @"The HTML could not be read"); return nil; }
    view = [[self alloc] initWithText:text];
  } else if ([type isEqual:@"pdf"]) {
    NSString *path = content[@"path"];
    if (![NSFileManager.defaultManager fileExistsAtPath:path]) { failure(@"E_NOT_FOUND", @"The PDF does not exist"); return nil; }
    PDFDocument *pdf = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:path]];
    if (!pdf) { failure(@"E_INVALID_DATA", @"The file is not a readable PDF"); return nil; }
    if (pdf.isLocked) { failure(@"E_PERMISSION_DENIED", @"The PDF is locked with a password"); return nil; }
    if (!pdf.pageCount) { failure(@"E_INVALID_DATA", @"The PDF has no pages"); return nil; }
    view = [[self alloc] initWithFrame:NSZeroRect];
    view->_pdf = pdf;
  } else if ([type isEqual:@"window"]) {
    NSWindow *window = SparkPrintWindow(content[@"windowId"]);
    if (!window) { failure(@"E_NOT_FOUND", @"The window does not exist"); return nil; }
    return [self viewWithSnapshotOf:window.contentView failure:failure];
  } else {
    failure(@"E_INVALID_ARGUMENT", @"Unknown print content type");
    return nil;
  }
  // Paper is white: dynamic colors (text without an explicit color) resolve in the light appearance.
  view.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  return view;
}

+ (instancetype)viewWithSnapshotOf:(NSView *)source failure:(SparkPrintFailure)failure
{
  NSRect bounds = source.bounds;
  if (NSIsEmptyRect(bounds)) { failure(@"E_INVALID_DATA", @"The view has no size to print"); return nil; }
  [source.window layoutIfNeeded];
  [source displayIfNeeded];
  // cacheDisplayInRect: draws layer colors and contents, which NSView printing omits (docs/printing.md).
  NSBitmapImageRep *rep = [source bitmapImageRepForCachingDisplayInRect:bounds];
  if (!rep) { failure(@"E_NATIVE", @"The view could not be rendered"); return nil; }
  [source cacheDisplayInRect:bounds toBitmapImageRep:rep];
  SparkPrintView *view = [[self alloc] initWithFrame:NSZeroRect];
  view->_image = [[NSImage alloc] initWithSize:bounds.size];
  [view->_image addRepresentation:rep];
  return view;
}

- (CGFloat)imageScale { return MIN(1, _page.width / _image.size.width); }

- (NSInteger)layoutPagesOfSize:(NSSize)size
{
  _page = size;
  if (_layout) {
    while (_layout.textContainers.count) [_layout removeTextContainerAtIndex:0];
    for (;;) {
      NSTextContainer *container = [[NSTextContainer alloc] initWithSize:size];
      container.lineFragmentPadding = 0;
      [_layout addTextContainer:container];
      NSRange glyphs = [_layout glyphRangeForTextContainer:container];
      if (NSMaxRange(glyphs) >= _layout.numberOfGlyphs) break;
      // A container that takes no glyphs would never finish the text; stop instead of adding pages forever.
      if (!glyphs.length) { _count = 0; return 0; }
    }
    _count = (NSInteger)_layout.textContainers.count;
  } else if (_image) {
    _count = MAX(1, (NSInteger)ceil(_image.size.height * self.imageScale / size.height - 0.001));
  } else {
    _count = _pdf.pageCount;
  }
  self.frame = NSMakeRect(0, 0, size.width, size.height * _count);
  return _count;
}

// Printing lays out for the paper the print panel settled on, so pages follow its paper, orientation and scale.
- (BOOL)knowsPageRange:(NSRangePointer)range
{
  NSPrintInfo *info = NSPrintOperation.currentOperation.printInfo;
  CGFloat scale = info.scalingFactor;
  NSSize page = NSMakeSize((info.paperSize.width - info.leftMargin - info.rightMargin) / scale, (info.paperSize.height - info.topMargin - info.bottomMargin) / scale);
  *range = NSMakeRange(1, MAX([self layoutPagesOfSize:page], 1));
  return YES;
}

- (NSRect)rectForPage:(NSInteger)number { return NSMakeRect(0, (number - 1) * _page.height, _page.width, _page.height); }

- (void)drawRect:(NSRect)dirty
{
  [NSColor.whiteColor setFill];
  NSRectFill(dirty);
  if (_image) {
    CGFloat scale = self.imageScale;
    NSSize size = NSMakeSize(_image.size.width * scale, _image.size.height * scale);
    [_image drawInRect:NSMakeRect((_page.width - size.width) / 2, 0, size.width, size.height) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
    return;
  }
  NSInteger first = MAX(0, (NSInteger)floor(NSMinY(dirty) / _page.height));
  NSInteger last = MIN(_count - 1, (NSInteger)ceil(NSMaxY(dirty) / _page.height) - 1);
  for (NSInteger index = first; index <= last; index++) {
    NSPoint origin = NSMakePoint(0, index * _page.height);
    if (_layout) {
      NSRange glyphs = [_layout glyphRangeForTextContainer:_layout.textContainers[index]];
      [_layout drawBackgroundForGlyphRange:glyphs atPoint:origin];
      [_layout drawGlyphsForGlyphRange:glyphs atPoint:origin];
      continue;
    }
    PDFPage *page = [_pdf pageAtIndex:index];
    NSSize size = [page boundsForBox:kPDFDisplayBoxCropBox].size;
    if (page.rotation % 180) size = NSMakeSize(size.height, size.width);
    CGFloat scale = MIN(_page.width / size.width, _page.height / size.height);
    NSRect target = NSMakeRect((_page.width - size.width * scale) / 2, origin.y + (_page.height - size.height * scale) / 2, size.width * scale, size.height * scale);
    CGContextRef context = NSGraphicsContext.currentContext.CGContext;
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, NSMinX(target), NSMaxY(target));
    CGContextScaleCTM(context, scale, -scale); // PDF page space is y-up.
    [page drawWithBox:kPDFDisplayBoxCropBox toContext:context];
    CGContextRestoreGState(context);
  }
}
@end

NSWindow *SparkPrintWindow(NSString *windowId)
{
  NSString *prefixed = [@"spark." stringByAppendingString:windowId];
  for (NSWindow *window in NSApp.windows) if ([window.identifier isEqual:windowId] || [window.identifier isEqual:prefixed]) return window;
  return nil;
}

NSPrintInfo *SparkPrintInfo(NSDictionary *pageSetup)
{
  NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
  info.horizontallyCentered = NO;
  info.verticallyCentered = NO;
  if (!pageSetup) return info;
  NSDictionary *paper = pageSetup[@"paperSize"], *margins = pageSetup[@"margins"];
  // AppKit swaps paperSize when the orientation changes, so the portrait sheet goes in first.
  info.orientation = NSPaperOrientationPortrait;
  info.paperSize = NSMakeSize([paper[@"width"] doubleValue], [paper[@"height"] doubleValue]);
  if ([pageSetup[@"orientation"] isEqual:@"landscape"]) info.orientation = NSPaperOrientationLandscape;
  info.topMargin = [margins[@"top"] doubleValue];
  info.rightMargin = [margins[@"right"] doubleValue];
  info.bottomMargin = [margins[@"bottom"] doubleValue];
  info.leftMargin = [margins[@"left"] doubleValue];
  return info;
}

NSPrintOperation *SparkPrintOperation(SparkPrintView *view, NSDictionary *pageSetup, NSString *jobTitle)
{
  NSPrintOperation *operation = [NSPrintOperation printOperationWithView:view printInfo:SparkPrintInfo(pageSetup)];
  if (jobTitle) operation.jobTitle = jobTitle;
  operation.showsPrintPanel = YES;
  operation.showsProgressPanel = YES;
  operation.printPanel.options |= NSPrintPanelShowsPreview | NSPrintPanelShowsCopies | NSPrintPanelShowsPageRange | NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation | NSPrintPanelShowsScaling;
  return operation;
}

// AppKit stores named papers with float noise (287.99999 for 4 x 6 in); 0.01 point is 1/7200 inch.
static NSNumber *SparkPoints(CGFloat value) { return @(round(value * 100) / 100); }

NSDictionary *SparkPageSetup(NSPrintInfo *info)
{
  NSSize paper = info.paperSize;
  return @{
    @"paperSize": @{ @"width": SparkPoints(MIN(paper.width, paper.height)), @"height": SparkPoints(MAX(paper.width, paper.height)) },
    @"orientation": info.orientation == NSPaperOrientationLandscape ? @"landscape" : @"portrait",
    @"margins": @{ @"top": SparkPoints(info.topMargin), @"right": SparkPoints(info.rightMargin), @"bottom": SparkPoints(info.bottomMargin), @"left": SparkPoints(info.leftMargin) },
  };
}

static NSString *SparkWriteErrorCode(NSError *error)
{
  if (![error.domain isEqual:NSCocoaErrorDomain]) return @"E_NATIVE";
  switch (error.code) {
    case NSFileNoSuchFileError: case NSFileWriteInvalidFileNameError: return @"E_NOT_FOUND";
    case NSFileWriteNoPermissionError: return @"E_PERMISSION_DENIED";
    case NSFileWriteOutOfSpaceError: return @"E_NO_SPACE";
    case NSFileWriteVolumeReadOnlyError: return @"E_READ_ONLY";
    default: return @"E_NATIVE";
  }
}

NSInteger SparkExportPDF(SparkPrintView *view, NSDictionary *pageSetup, NSString *path, NSString *title, SparkPrintFailure failure)
{
  BOOL directory = NO;
  if (![NSFileManager.defaultManager fileExistsAtPath:path.stringByDeletingLastPathComponent isDirectory:&directory] || !directory) { failure(@"E_NOT_FOUND", @"The PDF's folder does not exist"); return 0; }
  if ([NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&directory] && directory) { failure(@"E_ALREADY_EXISTS", @"A folder exists at the PDF path"); return 0; }
  NSDictionary *paper = pageSetup[@"paperSize"], *margins = pageSetup[@"margins"];
  BOOL landscape = [pageSetup[@"orientation"] isEqual:@"landscape"];
  CGFloat width = [paper[@"width"] doubleValue], height = [paper[@"height"] doubleValue];
  CGRect media = CGRectMake(0, 0, landscape ? height : width, landscape ? width : height);
  CGFloat top = [margins[@"top"] doubleValue], left = [margins[@"left"] doubleValue];
  NSSize page = NSMakeSize(media.size.width - left - [margins[@"right"] doubleValue], media.size.height - top - [margins[@"bottom"] doubleValue]);
  NSInteger count = [view layoutPagesOfSize:page];
  if (!count) { failure(@"E_INVALID_ARGUMENT", @"The content does not fit the printable area"); return 0; }

  NSMutableData *data = [NSMutableData data];
  CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData((__bridge CFMutableDataRef)data);
  NSMutableDictionary *info = [NSMutableDictionary new];
  if (title) info[(__bridge NSString *)kCGPDFContextTitle] = title;
  CGContextRef context = CGPDFContextCreate(consumer, &media, (__bridge CFDictionaryRef)info);
  CGDataConsumerRelease(consumer);
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithCGContext:context flipped:YES];
  [view.effectiveAppearance performAsCurrentDrawingAppearance:^{
    for (NSInteger index = 0; index < count; index++) {
      CGContextBeginPage(context, &media);
      CGContextSaveGState(context);
      // Top-left origin, y down, at the margins; the view's page `index` is clipped into place.
      CGContextTranslateCTM(context, left, media.size.height - top);
      CGContextScaleCTM(context, 1, -1);
      CGContextClipToRect(context, CGRectMake(0, 0, page.width, page.height));
      CGContextTranslateCTM(context, 0, -index * page.height);
      [view drawRect:NSMakeRect(0, index * page.height, page.width, page.height)];
      CGContextRestoreGState(context);
      CGContextEndPage(context);
    }
  }];
  [NSGraphicsContext restoreGraphicsState];
  CGPDFContextClose(context);
  CGContextRelease(context);
  NSError *error = nil;
  if (![data writeToFile:path options:NSDataWritingAtomic error:&error]) { failure(SparkWriteErrorCode(error), error.localizedDescription ?: @"The PDF could not be written"); return 0; }
  return count;
}
