#import "RNDesktopPrinting.h"
#import "SparkPrinting.h"
#import <RNDesktopApp/SparkDesktop.h>

// React Native macOS sets reactTag on every mounted component view (UIView+ComponentViewProtocol.h).
@interface NSView (SparkPrintingReactTag)
- (NSNumber *)reactTag;
@end

static NSView *SparkViewWithTag(NSView *view, NSInteger tag)
{
  if ([view respondsToSelector:@selector(reactTag)] && view.reactTag.integerValue == tag) return view;
  for (NSView *child in view.subviews) {
    NSView *match = SparkViewWithTag(child, tag);
    if (match) return match;
  }
  return nil;
}

@implementation RNDesktopPrinting {
  BOOL _presenting; // One print or page setup panel at a time.
  void (^_printed)(BOOL success);
}
RCT_EXPORT_MODULE(NativeDesktopPrinting)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (SparkPrintView *)viewForContent:(NSDictionary *)content failure:(SparkPrintFailure)failure
{
  if (![content[@"type"] isEqual:@"view"]) return [SparkPrintView viewWithContent:content failure:failure];
  NSInteger tag = [content[@"tag"] integerValue];
  for (NSWindow *window in NSApp.windows) {
    NSView *view = SparkViewWithTag(window.contentView, tag);
    if (view) return [SparkPrintView viewWithSnapshotOf:view failure:failure];
  }
  failure(@"E_NOT_FOUND", @"The view is not mounted in a window (a flattened View needs collapsable={false})");
  return nil;
}

- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)context
{
  void (^printed)(BOOL) = _printed;
  _printed = nil;
  printed(success);
}

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkPrintFailure failure = ^(NSString *code, NSString *message) { reject(code, message, nil); };
  if ([method isEqual:@"defaultPageSetup"]) { resolve(SparkJSON(SparkPageSetup(SparkPrintInfo(nil)))); return; }
  if ([method isEqual:@"exportPDF"]) {
    SparkPrintView *view = [self viewForContent:args[@"content"] failure:failure];
    if (!view) return;
    NSDictionary *pageSetup = args[@"pageSetup"] ?: SparkPageSetup(SparkPrintInfo(nil));
    NSInteger pages = SparkExportPDF(view, pageSetup, args[@"path"], args[@"title"], failure);
    if (pages) resolve(SparkJSON(@{ @"path": args[@"path"], @"numberOfPages": @(pages), @"pageSetup": pageSetup }));
    return;
  }
  if (![method isEqual:@"print"] && ![method isEqual:@"pageSetup"]) { SparkInvalid(reject, @"Unknown printing operation"); return; }
  if (_presenting) { failure(@"E_BUSY", @"A print or page setup panel is already open"); return; }
  NSWindow *owner = nil;
  if (args[@"windowId"]) {
    owner = SparkPrintWindow(args[@"windowId"]);
    if (!owner) { failure(@"E_NOT_FOUND", @"The owner window does not exist"); return; }
    if (owner.attachedSheet) { failure(@"E_BUSY", @"The owner window already has a sheet"); return; }
  }
  if ([method isEqual:@"pageSetup"]) {
    NSPrintInfo *info = SparkPrintInfo(args[@"pageSetup"]);
    void (^done)(BOOL) = ^(BOOL changed) {
      self->_presenting = NO;
      resolve(SparkJSON(changed ? @{ @"canceled": @NO, @"pageSetup": SparkPageSetup(info) } : @{ @"canceled": @YES }));
    };
    _presenting = YES;
    if (owner) [[NSPageLayout pageLayout] beginSheetUsingPrintInfo:info onWindow:owner completionHandler:^(NSPageLayoutResult result) { done(result == NSPageLayoutResultChanged); }];
    else done([[NSPageLayout pageLayout] runModalWithPrintInfo:info] == NSModalResponseOK);
    return;
  }
  SparkPrintView *view = [self viewForContent:args[@"content"] failure:failure];
  if (!view) return;
  NSPrintOperation *operation = SparkPrintOperation(view, args[@"pageSetup"], args[@"jobTitle"]);
  void (^done)(BOOL) = ^(BOOL success) {
    self->_presenting = NO;
    // AppKit sets NSPrintCancelJob when the panel is cancelled; any other unsuccessful run is a failure.
    if (success) resolve(SparkJSON(@{ @"canceled": @NO, @"pageSetup": SparkPageSetup(operation.printInfo) }));
    else if ([operation.printInfo.jobDisposition isEqual:NSPrintCancelJob]) resolve(SparkJSON(@{ @"canceled": @YES }));
    else failure(@"E_NATIVE", @"The print job did not complete");
  };
  _presenting = YES;
  if (owner) { _printed = done; [operation runOperationModalForWindow:owner delegate:self didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:NULL]; }
  else done([operation runOperation]);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopPrintingSpecJSI>(params);
}
@end
