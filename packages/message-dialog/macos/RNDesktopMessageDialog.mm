#import "RNDesktopMessageDialog.h"
#import <RNDesktopApp/SparkDesktop.h>
@interface RNDesktopMessageDialog ()
@property NSAlert *alert;
@end
@implementation RNDesktopMessageDialog
RCT_EXPORT_MODULE(NativeDesktopMessageDialog)
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [NSRunLoop.mainRunLoop performBlock:^{
    if (![method isEqual:@"show"]) { SparkInvalid(reject, @"Unknown dialog operation"); return; }
    if (self.alert) { reject(@"E_BUSY", @"A message dialog is already open", nil); return; }
    NSDictionary *args = SparkArgs(json); NSWindow *parent = nil;
    if (args[@"windowId"]) {
      for (NSWindow *window in NSApp.windows) if ([window.identifier isEqual:args[@"windowId"]] || [window.identifier isEqual:[@"spark." stringByAppendingString:args[@"windowId"]]]) { parent = window; break; }
      if (!parent) { reject(@"E_NOT_FOUND", @"Dialog parent does not exist", nil); return; }
      if (parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
    }
    NSAlert *alert = [NSAlert new]; self.alert = alert;
    alert.messageText = args[@"title"]; alert.informativeText = args[@"message"] ?: @"";
    alert.alertStyle = [args[@"kind"] isEqual:@"error"] ? NSAlertStyleCritical : [args[@"kind"] isEqual:@"warning"] ? NSAlertStyleWarning : NSAlertStyleInformational;
    for (NSString *title in args[@"buttons"]) [alert addButtonWithTitle:title];
    for (NSButton *button in alert.buttons) button.keyEquivalent = @"";
    NSUInteger defaultButton = [args[@"defaultButton"] unsignedIntegerValue];
    if (defaultButton < alert.buttons.count) alert.buttons[defaultButton].keyEquivalent = @"\r";
    if (args[@"cancelButton"] && [args[@"cancelButton"] unsignedIntegerValue] < alert.buttons.count) alert.buttons[[args[@"cancelButton"] unsignedIntegerValue]].keyEquivalent = @"\033";
    if (args[@"checkbox"]) { alert.showsSuppressionButton = YES; alert.suppressionButton.title = args[@"checkbox"][@"label"]; alert.suppressionButton.state = [args[@"checkbox"][@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff; }
    void (^complete)(NSModalResponse) = ^(NSModalResponse response) {
      self.alert = nil;
      resolve(SparkJSON(@{ @"button": @(response >= NSAlertFirstButtonReturn ? response - NSAlertFirstButtonReturn : -1), @"checked": @(alert.suppressionButton.state == NSControlStateValueOn) }));
    };
    if (parent) [alert beginSheetModalForWindow:parent completionHandler:complete]; else complete([alert runModal]);
  }];
}
- (void)invalidate { [NSRunLoop.mainRunLoop performBlock:^{ if (self.alert.window.sheetParent) [self.alert.window.sheetParent endSheet:self.alert.window returnCode:NSModalResponseCancel]; else if (self.alert) [NSApp abortModal]; [self.alert.window orderOut:nil]; self.alert = nil; }]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopMessageDialogSpecJSI>(params); }
@end
