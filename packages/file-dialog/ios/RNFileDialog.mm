#import "RNFileDialog.h"

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>

#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static NSArray<UTType *> *SparkContentTypes(NSArray<NSString *> *extensions)
{
  NSMutableArray<UTType *> *types = [NSMutableArray new];
  for (NSString *extension in extensions) {
    UTType *type = [UTType typeWithFilenameExtension:extension];
    if (type) [types addObject:type];
  }
  return types;
}

// Accessory controls are data: checkboxes and labeled pop-ups in a two-column grid. `controls`
// receives each control by ID so its final value can be read when the panel completes.
static NSView *SparkAccessoryView(NSArray<NSDictionary *> *specs, NSMutableDictionary<NSString *, NSControl *> *controls)
{
  NSMutableArray<NSArray<NSView *> *> *rows = [NSMutableArray arrayWithCapacity:specs.count];
  for (NSDictionary *spec in specs) {
    NSControl *control;
    if ([spec[@"type"] isEqual:@"checkbox"]) {
      NSButton *checkbox = [NSButton checkboxWithTitle:spec[@"label"] target:nil action:nil];
      checkbox.state = [spec[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
      [rows addObject:@[NSGridCell.emptyContentView, checkbox]];
      control = checkbox;
    } else {
      NSPopUpButton *popup = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
      for (NSDictionary *option in spec[@"options"]) [popup addItemWithTitle:option[@"label"]];
      NSUInteger selected = [[spec[@"options"] valueForKey:@"value"] indexOfObject:spec[@"value"]];
      if (selected != NSNotFound) [popup selectItemAtIndex:(NSInteger)selected];
      popup.accessibilityLabel = spec[@"label"];
      [rows addObject:@[[NSTextField labelWithString:spec[@"label"]], popup]];
      control = popup;
    }
    control.identifier = spec[@"id"];
    control.accessibilityIdentifier = spec[@"id"];
    controls[spec[@"id"]] = control;
  }
  NSGridView *grid = [NSGridView gridViewWithViews:rows];
  grid.rowSpacing = 8;
  grid.columnSpacing = 8;
  grid.rowAlignment = NSGridRowAlignmentFirstBaseline;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  NSSize size = grid.fittingSize;
  NSView *container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, size.width + 40, size.height + 24)];
  grid.frame = NSMakeRect(20, 12, size.width, size.height);
  grid.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin;
  [container addSubview:grid];
  return container;
}

static NSDictionary *SparkAccessoryValues(NSArray<NSDictionary *> *specs, NSDictionary<NSString *, NSControl *> *controls)
{
  NSMutableDictionary *values = [NSMutableDictionary dictionaryWithCapacity:specs.count];
  for (NSDictionary *spec in specs) {
    NSControl *control = controls[spec[@"id"]];
    if ([spec[@"type"] isEqual:@"checkbox"]) values[spec[@"id"]] = @(((NSButton *)control).state == NSControlStateValueOn);
    else values[spec[@"id"]] = spec[@"options"][(NSUInteger)((NSPopUpButton *)control).indexOfSelectedItem][@"value"];
  }
  return values;
}
#endif

@interface RNFileDialog ()
#if TARGET_OS_OSX
@property NSSavePanel *activePanel;
+ (NSDictionary *)configureOpenPanel:(NSOpenPanel *)panel options:(NSDictionary *)options;
+ (NSDictionary *)configureSavePanel:(NSSavePanel *)panel options:(NSDictionary *)options;
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

#if TARGET_OS_OSX
// Configure without presenting, so native tests can inspect panels. Each returns its accessory controls by ID.
+ (NSDictionary *)configureOpenPanel:(NSOpenPanel *)panel options:(NSDictionary *)options
{
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
    panel.allowedContentTypes = SparkContentTypes(allowedFileTypes);
    panel.allowsOtherFileTypes = NO;
  }

  NSString *directoryURL = [options[@"directoryURL"] isKindOfClass:[NSString class]] ? options[@"directoryURL"] : nil;
  if (directoryURL.length > 0) {
    NSURL *url = [directoryURL hasPrefix:@"file://"] ? [NSURL URLWithString:directoryURL] : [NSURL fileURLWithPath:directoryURL];
    if (url) {
      panel.directoryURL = url;
    }
  }
  NSMutableDictionary *controls = [NSMutableDictionary new];
  if ([options[@"accessory"] isKindOfClass:[NSArray class]]) {
    panel.accessoryView = SparkAccessoryView(options[@"accessory"], controls);
    panel.accessoryViewDisclosed = YES;
  }
  return controls;
}

+ (NSDictionary *)configureSavePanel:(NSSavePanel *)panel options:(NSDictionary *)options
{
  panel.canCreateDirectories = YES;
  panel.showsTagField = NO;

  NSString *defaultName = [options[@"defaultName"] isKindOfClass:[NSString class]] && [(NSString *)options[@"defaultName"] length] > 0 ? options[@"defaultName"] : nil;

  NSArray *allowedFileTypes = [options[@"allowedFileTypes"] isKindOfClass:[NSArray class]] ? options[@"allowedFileTypes"] : nil;
  if (allowedFileTypes.count > 0) {
    panel.allowedContentTypes = SparkContentTypes(allowedFileTypes);
  }

  // defaultPath may name a file: a live directory starts the panel, otherwise the
  // last component suggests the name (an explicit defaultName wins) and the parent starts it.
  NSString *directory = [options[@"directory"] isKindOfClass:[NSString class]] ? options[@"directory"] : nil;
  if (directory.length > 0) {
    BOOL isDirectory = NO;
    if ([[NSFileManager defaultManager] fileExistsAtPath:directory isDirectory:&isDirectory] && isDirectory) {
      panel.directoryURL = [NSURL fileURLWithPath:directory isDirectory:YES];
    } else {
      NSString *parent = [directory stringByDeletingLastPathComponent];
      if (defaultName.length == 0) defaultName = [directory lastPathComponent];
      if (parent.length > 0) panel.directoryURL = [NSURL fileURLWithPath:parent isDirectory:YES];
    }
  }
  if (defaultName.length > 0) {
    panel.nameFieldStringValue = defaultName;
  }
  NSMutableDictionary *controls = [NSMutableDictionary new];
  if ([options[@"accessory"] isKindOfClass:[NSArray class]]) panel.accessoryView = SparkAccessoryView(options[@"accessory"], controls);
  return controls;
}

// With accessory controls, the selection is wrapped as { <key>: selection, accessory: values }.
- (id)selection:(id)selection key:(NSString *)key options:(NSDictionary *)options controls:(NSDictionary *)controls
{
  if (![options[@"accessory"] isKindOfClass:[NSArray class]]) return selection;
  return @{ key: selection, @"accessory": SparkAccessoryValues(options[@"accessory"], controls) };
}
#endif

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
    NSDictionary *controls = [RNFileDialog configureOpenPanel:panel options:options];
    void (^complete)(NSModalResponse) = ^(NSModalResponse result) {
      self.activePanel = nil;
      if (result != NSModalResponseOK) { resolve(@"null"); return; }
      NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:panel.URLs.count];
      for (NSURL *url in panel.URLs) if (url.path.length > 0) [paths addObject:url.path];
      resolve([self jsonStringFromObject:[self selection:paths key:@"paths" options:options controls:controls]]);
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
    NSDictionary *controls = [RNFileDialog configureSavePanel:panel options:options];
    void (^complete)(NSModalResponse) = ^(NSModalResponse result) {
      self.activePanel = nil;
      if (result == NSModalResponseOK && panel.URL.path.length > 0) {
        resolve([self jsonStringFromObject:[self selection:panel.URL.path key:@"path" options:options controls:controls]]);
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
