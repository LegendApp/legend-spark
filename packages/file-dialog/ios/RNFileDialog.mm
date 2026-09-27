#import "RNFileDialog.h"

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>

#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#endif

@interface RNFileDialog ()
#if TARGET_OS_OSX
@property NSSavePanel *activePanel;
#endif
@end
@implementation RNFileDialog

RCT_EXPORT_MODULE(NativeFileDialog)

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeFileDialogSpecJSI>(params);
}

- (NSDictionary *)parseObjectJSON:(NSString *)json
{
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) {
    return @{};
  }

  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:[NSDictionary class]] ? value : @{};
}

- (NSString *)jsonStringFromObject:(id)object
{
  id value = object ?: [NSNull null];
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

- (void)open:(NSString *)optionsJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  RCTExecuteOnMainQueue(^{
    if (self.activePanel) { reject(@"E_BUSY", @"A file dialog is already open", nil); return; }
    NSDictionary *options = [self parseObjectJSON:optionsJson];
    NSWindow *parent = nil;
    if (options[@"windowId"]) {
      for (NSWindow *candidate in NSApp.windows) if ([candidate.identifier isEqual:options[@"windowId"]] || [candidate.identifier isEqual:[@"spark." stringByAppendingString:options[@"windowId"]]]) { parent = candidate; break; }
      if (!parent) { reject(@"E_NOT_FOUND", @"Dialog owner does not exist", nil); return; }
      if (parent.attachedSheet) { reject(@"E_BUSY", @"Dialog owner already has a sheet", nil); return; }
    }
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    self.activePanel = panel;
    panel.canChooseFiles = options[@"canChooseFiles"] ? [options[@"canChooseFiles"] boolValue] : YES;
    panel.canChooseDirectories = options[@"canChooseDirectories"] ? [options[@"canChooseDirectories"] boolValue] : NO;
    panel.allowsMultipleSelection = options[@"allowsMultipleSelection"] ? [options[@"allowsMultipleSelection"] boolValue] : NO;
    panel.resolvesAliases = YES;
    panel.treatsFilePackagesAsDirectories = YES;

    NSString *title = [options[@"title"] isKindOfClass:[NSString class]] ? options[@"title"] : nil;
    if (title.length > 0) {
      panel.title = title;
    }

    NSString *message = [options[@"message"] isKindOfClass:[NSString class]] ? options[@"message"] : nil;
    if (message.length > 0) {
      panel.message = message;
    }

    NSString *prompt = [options[@"prompt"] isKindOfClass:[NSString class]] ? options[@"prompt"] : nil;
    if (prompt.length > 0) {
      panel.prompt = prompt;
    }

    NSArray *allowedFileTypes = [options[@"allowedFileTypes"] isKindOfClass:[NSArray class]] ? options[@"allowedFileTypes"] : nil;
    if (allowedFileTypes.count > 0 && panel.canChooseFiles) {
      panel.allowedFileTypes = allowedFileTypes;
      panel.allowsOtherFileTypes = NO;
    }

    NSString *directoryURL = [options[@"directoryURL"] isKindOfClass:[NSString class]] ? options[@"directoryURL"] : nil;
    if (directoryURL.length > 0) {
      NSURL *url = [directoryURL hasPrefix:@"file://"] ? [NSURL URLWithString:directoryURL] : [NSURL fileURLWithPath:directoryURL];
      if (url) {
        panel.directoryURL = url;
      }
    }

    void (^complete)(NSModalResponse) = ^(NSModalResponse result) {
      self.activePanel = nil;
      if (result != NSModalResponseOK) { resolve(@"null"); return; }
      NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:panel.URLs.count];
      for (NSURL *url in panel.URLs) if (url.path.length > 0) [paths addObject:url.path];
      resolve([self jsonStringFromObject:paths]);
    };
    if (parent) [panel beginSheetModalForWindow:parent completionHandler:complete];
    else [panel beginWithCompletionHandler:complete];
  });
#else
  resolve(@"null");
#endif
}

- (void)save:(NSString *)optionsJson resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  RCTExecuteOnMainQueue(^{
    if (self.activePanel) { reject(@"E_BUSY", @"A file dialog is already open", nil); return; }
    NSDictionary *options = [self parseObjectJSON:optionsJson];
    NSWindow *parent = nil;
    if (options[@"windowId"]) {
      for (NSWindow *candidate in NSApp.windows) if ([candidate.identifier isEqual:options[@"windowId"]] || [candidate.identifier isEqual:[@"spark." stringByAppendingString:options[@"windowId"]]]) { parent = candidate; break; }
      if (!parent) { reject(@"E_NOT_FOUND", @"Dialog owner does not exist", nil); return; }
      if (parent.attachedSheet) { reject(@"E_BUSY", @"Dialog owner already has a sheet", nil); return; }
    }
    NSSavePanel *panel = [NSSavePanel savePanel];
    self.activePanel = panel;
    panel.canCreateDirectories = YES;
    panel.showsTagField = NO;

    NSString *defaultName = [options[@"defaultName"] isKindOfClass:[NSString class]] ? options[@"defaultName"] : nil;
    if (defaultName.length > 0) {
      panel.nameFieldStringValue = defaultName;
    }

    NSArray *allowedFileTypes = [options[@"allowedFileTypes"] isKindOfClass:[NSArray class]] ? options[@"allowedFileTypes"] : nil;
    if (allowedFileTypes.count > 0) {
      panel.allowedFileTypes = allowedFileTypes;
    }

    NSString *directory = [options[@"directory"] isKindOfClass:[NSString class]] ? options[@"directory"] : nil;
    if (directory.length > 0) {
      panel.directoryURL = [NSURL fileURLWithPath:directory isDirectory:YES];
    }

    void (^complete)(NSModalResponse) = ^(NSModalResponse result) {
      self.activePanel = nil;
      if (result == NSModalResponseOK && panel.URL.path.length > 0) {
        resolve([self jsonStringFromObject:panel.URL.path]);
      } else {
        resolve(@"null");
      }
    };
    if (parent) [panel beginSheetModalForWindow:parent completionHandler:complete];
    else [panel beginWithCompletionHandler:complete];
  });
#else
  resolve(@"null");
#endif
}

- (void)invalidate
{
#if TARGET_OS_OSX
  RCTExecuteOnMainQueue(^{ [self.activePanel cancel:nil]; self.activePanel = nil; });
#endif
}

@end
