#import "RNDesktopMessageDialog.h"
#import <RNDesktopApp/SparkDesktop.h>
@interface RNDesktopMessageDialog ()
@property NSAlert *alert;
+ (NSAlert *)alertWithArgs:(NSDictionary *)args;
+ (NSDictionary *)aboutPanelOptions:(NSDictionary *)args code:(NSString **)code message:(NSString **)message;
@end
@implementation RNDesktopMessageDialog
RCT_EXPORT_MODULE(NativeDesktopMessageDialog)
// Configures the alert without presenting it, so native tests can inspect and render it.
+ (NSAlert *)alertWithArgs:(NSDictionary *)args {
  NSAlert *alert = [NSAlert new];
  alert.messageText = args[@"title"]; alert.informativeText = args[@"message"] ?: @"";
  alert.alertStyle = [args[@"kind"] isEqual:@"error"] ? NSAlertStyleCritical : [args[@"kind"] isEqual:@"warning"] ? NSAlertStyleWarning : NSAlertStyleInformational;
  for (NSString *title in args[@"buttons"]) [alert addButtonWithTitle:title];
  for (NSButton *button in alert.buttons) button.keyEquivalent = @"";
  NSUInteger defaultButton = [args[@"defaultButton"] unsignedIntegerValue];
  if (defaultButton < alert.buttons.count) alert.buttons[defaultButton].keyEquivalent = @"\r";
  if (args[@"cancelButton"] && [args[@"cancelButton"] unsignedIntegerValue] < alert.buttons.count) alert.buttons[[args[@"cancelButton"] unsignedIntegerValue]].keyEquivalent = @"\033";
  if (args[@"checkbox"]) { alert.showsSuppressionButton = YES; alert.suppressionButton.title = args[@"checkbox"][@"label"]; alert.suppressionButton.state = [args[@"checkbox"][@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff; }
  if (NSDictionary *input = args[@"input"]) {
    NSTextField *field = [input[@"secure"] boolValue] ? [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 260, 22)] : [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 260, 22)];
    field.stringValue = input[@"defaultValue"] ?: @"";
    if ([input[@"placeholder"] isKindOfClass:NSString.class]) field.placeholderString = input[@"placeholder"];
    field.accessibilityLabel = args[@"title"];
    alert.accessoryView = field;
    alert.window.initialFirstResponder = field;
  }
  return alert;
}
// Maps Spark's About options onto AppKit's keys; omitted keys keep the bundle's values.
+ (NSDictionary *)aboutPanelOptions:(NSDictionary *)args code:(NSString **)code message:(NSString **)message {
  NSMutableDictionary *options = [NSMutableDictionary new];
  if (args[@"name"]) options[NSAboutPanelOptionApplicationName] = args[@"name"];
  if (args[@"version"]) options[NSAboutPanelOptionApplicationVersion] = args[@"version"];
  if (args[@"build"]) options[NSAboutPanelOptionVersion] = args[@"build"];
  if (args[@"copyright"]) options[@"Copyright"] = args[@"copyright"];
  if (args[@"credits"]) {
    NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new]; paragraph.alignment = NSTextAlignmentCenter;
    options[NSAboutPanelOptionCredits] = [[NSAttributedString alloc] initWithString:args[@"credits"] attributes:@{ NSFontAttributeName: [NSFont systemFontOfSize:NSFont.smallSystemFontSize], NSForegroundColorAttributeName: NSColor.labelColor, NSParagraphStyleAttributeName: paragraph }];
  }
  if (NSString *path = args[@"iconPath"]) {
    if (![NSFileManager.defaultManager fileExistsAtPath:path]) { *code = @"E_NOT_FOUND"; *message = @"About panel icon does not exist"; return nil; }
    NSImage *icon = [[NSImage alloc] initWithContentsOfFile:path];
    if (!icon) { *code = @"E_INVALID_DATA"; *message = @"About panel icon is not a readable image"; return nil; }
    options[NSAboutPanelOptionApplicationIcon] = icon;
  }
  return options;
}
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [NSRunLoop.mainRunLoop performBlock:^{
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"about"]) {
      NSString *code = nil, *message = nil;
      NSDictionary *options = [RNDesktopMessageDialog aboutPanelOptions:args code:&code message:&message];
      if (!options) { reject(code, message, nil); return; }
      [NSApp orderFrontStandardAboutPanelWithOptions:options];
      resolve(@"null"); return;
    }
    if (![method isEqual:@"show"]) { SparkInvalid(reject, @"Unknown dialog operation"); return; }
    if (self.alert) { reject(@"E_BUSY", @"A message dialog is already open", nil); return; }
    NSWindow *parent = nil;
    if (args[@"windowId"]) {
      for (NSWindow *window in NSApp.windows) if ([window.identifier isEqual:args[@"windowId"]] || [window.identifier isEqual:[@"spark." stringByAppendingString:args[@"windowId"]]]) { parent = window; break; }
      if (!parent) { reject(@"E_NOT_FOUND", @"Dialog parent does not exist", nil); return; }
      if (parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
    }
    NSAlert *alert = [RNDesktopMessageDialog alertWithArgs:args]; self.alert = alert;
    void (^complete)(NSModalResponse) = ^(NSModalResponse response) {
      self.alert = nil;
      NSMutableDictionary *result = [@{ @"button": @(response >= NSAlertFirstButtonReturn ? response - NSAlertFirstButtonReturn : -1), @"checked": @(alert.suppressionButton.state == NSControlStateValueOn) } mutableCopy];
      if (args[@"input"]) result[@"value"] = ((NSTextField *)alert.accessoryView).stringValue;
      resolve(SparkJSON(result));
    };
    if (parent) [alert beginSheetModalForWindow:parent completionHandler:complete]; else complete([alert runModal]);
  }];
}
- (void)invalidate { [NSRunLoop.mainRunLoop performBlock:^{ if (self.alert.window.sheetParent) [self.alert.window.sheetParent endSheet:self.alert.window returnCode:NSModalResponseCancel]; else if (self.alert) [NSApp abortModal]; [self.alert.window orderOut:nil]; self.alert = nil; }]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopMessageDialogSpecJSI>(params); }
@end
