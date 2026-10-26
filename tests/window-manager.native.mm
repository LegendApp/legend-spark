#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <CoreGraphics/CoreGraphics.h>
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>
#include <memory>
#include <cmath>
#include <cassert>
#define RCT_EXPORT_MODULE(...)
static void RCTExecuteOnMainQueue(dispatch_block_t block) { block(); }
@interface RCTUIView : NSView
@property NSColor *backgroundColor;
@end
@implementation RCTUIView @end
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeDesktopWindowManagerSpecJSI : TurboModule { NativeDesktopWindowManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
struct NativeWindowManagerSpecJSI : TurboModule { NativeWindowManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
namespace ReactMarker { struct StartupLogger {
 static StartupLogger& getInstance() { static StartupLogger value; return value; }
 double getAppStartupStartTime() { return NAN; }
 double getInitReactRuntimeStartTime() { return NAN; }
 double getRunJSBundleStartTime() { return NAN; }
 double getRunJSBundleEndTime() { return NAN; }
 double getInitReactRuntimeEndTime() { return NAN; }
 double getAppStartupEndTime() { return NAN; }
}; }
}
@interface RCTBridge : NSObject @end
@implementation RCTBridge @end
@interface RCTEventEmitter : NSObject
@property RCTBridge *bridge;
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(id)body {}
- (void)invalidate {}
@end
@interface RCTRootViewFactory : NSObject
- (NSView *)viewWithModuleName:(NSString *)name initialProperties:(NSDictionary *)props;
@end
@implementation RCTRootViewFactory
- (NSView *)viewWithModuleName:(NSString *)name initialProperties:(NSDictionary *)props { return nil; }
@end
@interface RCTRootView : RCTUIView
- (instancetype)initWithBridge:(RCTBridge *)bridge moduleName:(NSString *)name initialProperties:(NSDictionary *)props;
@end
@implementation RCTRootView
- (instancetype)initWithBridge:(RCTBridge *)bridge moduleName:(NSString *)name initialProperties:(NSDictionary *)props { return [super init]; }
@end
@interface RNWindowManager : RCTEventEmitter
+ (NSWindow *)getMainWindow;
@end
static NSMutableArray *events;
NSString *const SparkDesktopEvent = @"desktop";
void SparkEmit(NSDictionary *event) { [events addObject:event]; }
NSDictionary *SparkStartupTiming() { return @{}; }
NSDictionary *SparkLifecycleConfiguration() { return @{}; }
@interface RCTSurface : NSObject
- (void)stop;
@end
@implementation RCTSurface
- (void)stop {}
@end
@interface RCTSurfaceHostingView : NSView
@property RCTSurface *surface;
@end
@implementation RCTSurfaceHostingView @end
@interface RNDesktopWindows : RCTEventEmitter @end
static BOOL testSafeMode, testDriverMode;
static BOOL SparkSafeMode(void) { return testSafeMode; }
static BOOL SparkTestDriverActive(void) { return testDriverMode; }
NSString *SparkNamespace(void) { return @"spark-window-manager-test"; }
NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:0 error:nil] encoding:NSUTF8StringEncoding]; }
void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
@interface TestDefaults : NSObject
@property NSMutableDictionary *values;
@property NSUInteger reads;
@end
@implementation TestDefaults
- (instancetype)init { if ((self = [super init])) self.values = [NSMutableDictionary new]; return self; }
- (id)arrayForKey:(NSString *)key { self.reads++; return self.values[key]; }
- (id)dictionaryForKey:(NSString *)key { self.reads++; return self.values[key]; }
- (id)stringForKey:(NSString *)key { return self.values[key]; }
- (void)setObject:(id)value forKey:(NSString *)key { self.values[key] = value; }
- (void)removeObjectForKey:(NSString *)key { [self.values removeObjectForKey:key]; }
@end
static TestDefaults *testDefaults;
@interface MainWindowOwner : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@end
@implementation MainWindowOwner @end
// ACTUAL_IMPLEMENTATION
extern "C" void LegendPrepareSidebarSplitViewStartup(NSWindow *, NSDictionary *) {}
extern "C" BOOL LegendAttachSidebarSplitViewStartupRoot(NSWindow *, NSView *, void (^)(void)) { return NO; }
extern "C" void LegendFinishSidebarSplitViewStartup(NSWindow *) {}
static void CallWindow(RNDesktopWindows *module, NSString *method, NSDictionary *args) {
  __block BOOL done = NO;
  [module call:method args:SparkJSON(args) resolve:^(id) { done = YES; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
  while (!done && deadline.timeIntervalSinceNow > 0) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  assert(done);
}
int main() { @autoreleasepool {
  testDefaults = [TestDefaults new];
  events = [NSMutableArray new];
  RNWindowManager *manager = [RNWindowManager new];
  NSSlider *slider = [NSSlider sliderWithValue:0.375 minValue:0 maxValue:1 target:nil action:nil];
  objc_setAssociatedObject(slider, &LegendToolbarControlMetadataKey, @{ @"windowIdentifier": @"editor", @"instanceId": @"instance", @"itemId": @"menu", @"value": @"volume" }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [manager toolbarMenuSliderChanged:slider];
  NSDictionary *event = events.lastObject;
  assert([event[@"type"] isEqual:@"toolbarMenuAction"]);
  assert([event[@"instanceId"] isEqual:@"instance"]);
  assert([event[@"action"][@"type"] isEqual:@"valueChanged"]);
  assert([event[@"action"][@"itemId"] isEqual:@"volume"]);
  assert([event[@"action"][@"value"] doubleValue] == 0.375);
  NSSegmentedControl *segment = [[NSSegmentedControl alloc] initWithFrame:NSZeroRect]; segment.segmentCount = 1; segment.selectedSegment = 0;
  objc_setAssociatedObject(segment, &LegendToolbarControlMetadataKey, @{ @"windowIdentifier": @"editor", @"instanceId": @"instance", @"itemId": @"segment", @"values": @[@""] }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [manager toolbarSegmentedControlChanged:segment];
  assert([events.lastObject[@"type"] isEqual:@"toolbarSelectionChanged"]);
  assert([events.lastObject[@"value"] isEqual:@""]);
  __block NSString *error = nil;
  [manager setWindowOptions:@"missing" optionsJson:@"{}" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { error = code; }];
  assert([error isEqual:@"E_NOT_FOUND"]); assert(!manager.windowOptions[@"missing"]);
  // An item shows text only when it declares a label; the fallback name never becomes its title.
  NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"LegendToolbarTest"];
  manager.toolbarItemConfigs[toolbar.identifier] = @[
    @{ @"id": @"icon-only", @"type": @"menuButton", @"systemImageName": @"square.and.pencil", @"menuItems": @[] },
    @{ @"id": @"labelled", @"type": @"menuButton", @"label": @"Elapsed", @"systemImageName": @"sun.max", @"menuItems": @[] },
    @{ @"id": @"text-only", @"type": @"menuButton", @"label": @"Start", @"menuItems": @[] },
    @{ @"id": @"empty-label", @"type": @"menuButton", @"label": @"", @"menuItems": @[] },
  ];
  NSToolbarItem *iconOnly = [manager toolbar:toolbar itemForItemIdentifier:@"legend.toolbar.icon-only" willBeInsertedIntoToolbar:YES];
  assert([iconOnly.view isKindOfClass:NSButton.class]);
  assert([(NSButton *)iconOnly.view title].length == 0);
  assert([(NSButton *)iconOnly.view image] != nil);
  assert([(NSButton *)iconOnly.view imagePosition] == NSImageOnly);
  assert([iconOnly.label isEqual:@"icon-only"]);
  NSToolbarItem *labelled = [manager toolbar:toolbar itemForItemIdentifier:@"legend.toolbar.labelled" willBeInsertedIntoToolbar:YES];
  assert([(NSButton *)labelled.view title].length > 0);
  assert([(NSButton *)labelled.view imagePosition] == NSImageLeft);
  NSToolbarItem *textOnly = [manager toolbar:toolbar itemForItemIdentifier:@"legend.toolbar.text-only" willBeInsertedIntoToolbar:YES];
  assert([[[(NSButton *)textOnly.view title] copy] isEqual:@"Start"]);
  NSToolbarItem *emptyLabel = [manager toolbar:toolbar itemForItemIdentifier:@"legend.toolbar.empty-label" willBeInsertedIntoToolbar:YES];
  assert([(NSButton *)emptyLabel.view title].length == 0);
  assert([(NSButton *)emptyLabel.view frame].size.width <= LegendToolbarIconControlWidth);
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1280, 820)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  MainWindowOwner *owner = [MainWindowOwner new]; owner.window = window; NSApp.delegate = owner;
  // The host owns "main": it reaches the registry only after a window module call, so early calls must not depend on it.
  assert(manager.windows[@"main"] == nil);
  [manager setWindowOptions:@"main" optionsJson:SparkJSON(@{ @"title": @"Early" }) resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert([window.title isEqual:@"Early"]);
  [manager setWindowToolbarItemText:@"main" itemId:@"missing" text:@"" resolve:^(id result) { assert(![result containsString:@"Window not found"]); } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  NSDictionary *split = @{ @"restoreOnLaunch": @YES, @"sidebar": @{ @"width": @240 } };
  for (NSString *mode in @[@"safe", @"driver"]) {
    testSafeMode = [mode isEqual:@"safe"]; testDriverMode = !testSafeMode;
    NSArray *saved = @[SparkJSON(@{ @"identifier": @"persisted", @"title": @"Saved title", @"restoreOnLaunch": @YES })];
    testDefaults.values[LegendRestorableWindowOptionsDefaultsKey] = saved;
    testDefaults.values[LegendMainWindowStartupSplitViewKey] = split;
    NSUInteger reads = testDefaults.reads;
    assert(LegendReadRestorableWindowOptions().count == 0);
    assert(LegendMainWindowStartupSplitViewConfiguration() == nil);
    [manager recordWindowOptions:@{ @"restoreOnLaunch": @YES, @"width": @600 } identifier:@"persisted" moduleName:@"test"];
    assert(manager.windowOptions[@"persisted"][@"title"] == nil);
    [manager recordWindowOptions:@{ @"height": @400 } identifier:@"persisted" moduleName:@"test"];
    assert([manager.windowOptions[@"persisted"][@"width"] isEqual:@600]);
    [manager handleWindowClosedForIdentifier:@"persisted" closeWindow:NO];
    assert(manager.windowOptions[@"persisted"] == nil);
    assert([testDefaults.values[LegendRestorableWindowOptionsDefaultsKey] isEqual:saved]);
    for (id layout in @[@{ @"restoreOnLaunch": @YES, @"sidebar": @{ @"width": @300 } }, NSNull.null]) {
      [manager setMainWindowOptions:SparkJSON(@{ @"windowStyle": @{ @"startupSplitView": layout } }) resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
      assert([testDefaults.values[LegendMainWindowStartupSplitViewKey] isEqual:split]);
    }
    [manager hideMainWindow:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
    assert([testDefaults.values[LegendMainWindowStartupSplitViewKey] isEqual:split]);
    assert(testDefaults.reads == reads);
  }
  testSafeMode = testDriverMode = NO;
  assert([LegendMainWindowStartupSplitViewConfiguration() isEqual:split]);
  [manager recordWindowOptions:@{ @"width": @610 } identifier:@"persisted" moduleName:@"test"];
  assert([manager.windowOptions[@"persisted"][@"title"] isEqual:@"Saved title"]);
  assert([LegendFindRestorableWindowOptions(@"persisted")[@"width"] isEqual:@610]);
  [manager handleWindowClosedForIdentifier:@"persisted" closeWindow:NO];
  assert(LegendReadRestorableWindowOptions().count == 0);
  [manager hideMainWindow:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(testDefaults.values[LegendMainWindowStartupSplitViewKey] == nil);
  [manager setMainWindowOptions:SparkJSON(@{ @"windowStyle": @{ @"startupSplitView": split } }) resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert([testDefaults.values[LegendMainWindowStartupSplitViewKey] isEqual:split]);
  [manager setMainWindowOptions:SparkJSON(@{ @"windowStyle": @{ @"startupSplitView": NSNull.null } }) resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(testDefaults.values[LegendMainWindowStartupSplitViewKey] == nil);
  RNDesktopWindows *module = [RNDesktopWindows new];
  NSString *boundsKey = [SparkNamespace() stringByAppendingString:@".bounds.bounds-probe"];
  NSDictionary *savedBounds = @{ @"version": @1, @"bounds": @{ @"x": @100, @"y": @100, @"width": @500, @"height": @350 } };
  for (NSString *mode in @[@"safe", @"driver", @"normal"]) {
    testSafeMode = [mode isEqual:@"safe"]; testDriverMode = [mode isEqual:@"driver"];
    NSWindow *probe = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 200) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    probe.releasedWhenClosed = NO;
    LegendWindowRegistry.sharedRegistry.windows[@"bounds-probe"] = probe;
    testDefaults.values[boundsKey] = savedBounds;
    NSUInteger reads = testDefaults.reads;
    CallWindow(module, @"completeOpen", @{ @"id": @"bounds-probe", @"restoreBounds": @YES, @"show": @NO });
    BOOL restoring = [mode isEqual:@"normal"];
    assert(probe.frame.size.width == (restoring ? 500 : 640));
    assert(probe.frame.size.height == (restoring ? 350 : 480));
    assert(delegates[@"bounds-probe"].restoreBounds == restoring);
    [probe setFrame:NSMakeRect(10, 10, 700, 500) display:NO]; Event(@"resize", @"bounds-probe");
    if (restoring) assert([testDefaults.values[boundsKey][@"bounds"][@"width"] isEqual:@700]);
    else { assert([testDefaults.values[boundsKey] isEqual:savedBounds]); assert(testDefaults.reads == reads); }
    [probe close];
  }
  testSafeMode = testDriverMode = NO;
  RCTUIView *rootView = [[RCTUIView alloc] initWithFrame:window.contentView.bounds];
  window.contentView = rootView;
  LegendApplyWindowOptions(window, @{ @"windowStyle": @{ @"contentLayoutMode": @"fullSize" } });
  assert((window.styleMask & NSWindowStyleMaskFullSizeContentView) != 0);
  assert(window.contentView != rootView);
  assert(NSEqualRects(rootView.frame, window.contentView.bounds));
  LegendApplyWindowOptions(window, @{ @"windowStyle": @{ @"appearance": @"dark", @"backgroundColor": @"#191A1B", @"titlebarAppearsTransparent": @YES } });
  assert(LegendWindowUsesDarkAppearance(window));
  LegendApplyWindowOptions(window, @{ @"windowStyle": @{ @"appearance": @"light", @"backgroundColor": @"#f5f6f8", @"contentLayoutMode": @"contentLayoutGuide", @"titlebarAppearsTransparent": @YES } });
  assert(!LegendWindowUsesDarkAppearance(window));
  assert((window.styleMask & NSWindowStyleMaskFullSizeContentView) == 0);
  assert((window.styleMask & NSWindowStyleMaskTitled) != 0);
  assert((window.styleMask & NSWindowStyleMaskResizable) != 0);
  NSColor *lightBackground = LegendColorFromHexString(@"#f5f6f8");
  assert([window.backgroundColor isEqual:lightBackground]);
  assert(CGColorEqualToColor(window.contentView.layer.backgroundColor, lightBackground.CGColor));
  LegendApplyWindowOptions(window, @{ @"windowStyle": @{ @"contentLayoutMode": @"fullSize" } });
  assert((window.styleMask & NSWindowStyleMaskFullSizeContentView) != 0);
  assert(NSEqualRects(rootView.frame, window.contentView.bounds));
  LegendApplyWindowOptions(window, @{ @"windowStyle": @{ @"appearance": @"system" } });
  assert(window.appearance == nil);
  manager.windows[@"brightness-probe"] = window;
  NSDictionary *(^options)(double, NSString *) = ^NSDictionary *(double value, NSString *elapsed) {
    return @{ @"windowStyle": @{ @"toolbarItems": @[
      @{ @"id": @"appearance", @"type": @"menuButton", @"width": @36,
         @"menuItems": @[@{ @"id": @"brightness", @"title": @"Brightness", @"slider": @{ @"min": @0, @"max": @100, @"value": @(value) } }] },
      @{ @"id": @"start", @"type": @"button", @"label": @"Start" },
      @{ @"id": @"elapsed", @"type": @"menuButton", @"label": elapsed, @"width": @76, @"menuItems": @[] }
    ] } };
  };
  [manager applyToolbarItemsFromOptions:options(17, @"0:00") toWindow:window identifier:@"brightness-probe"];
  NSArray *originalItems = [window.toolbar.items copy];
  NSToolbarItem *appearance = nil;
  for (NSToolbarItem *item in originalItems) if ([item.itemIdentifier isEqual:@"legend.toolbar.appearance"]) appearance = item;
  assert(appearance != nil);
  NSView *anchor = appearance.view;
  NSRect originalFrame = window.frame;
  for (NSNumber *value in @[@80, @40, @0, @100, @17]) {
    NSString *elapsed = [NSString stringWithFormat:@"0:%02ld", value.longValue];
    [manager setWindowToolbarItemText:@"brightness-probe" itemId:@"elapsed" text:elapsed resolve:^(id result) { assert([result containsString:@"true"]); } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
    [manager applyToolbarItemsFromOptions:options(value.doubleValue, elapsed) toWindow:window identifier:@"brightness-probe"];
    assert([window.toolbar.items isEqualToArray:originalItems]);
    assert(appearance.view == anchor);
    assert(NSEqualRects(window.frame, originalFrame));
    NSDictionary *metadata = objc_getAssociatedObject(anchor, &LegendToolbarControlMetadataKey);
    assert([metadata[@"menuItems"][0][@"slider"][@"value"] doubleValue] == value.doubleValue);
  }
  NSMutableDictionary *changed = [options(17, @"0:17") mutableCopy];
  NSMutableDictionary *style = [changed[@"windowStyle"] mutableCopy];
  NSMutableArray *changedItems = [style[@"toolbarItems"] mutableCopy];
  NSMutableDictionary *start = [changedItems[1] mutableCopy];
  start[@"label"] = @"Stop"; changedItems[1] = start;
  style[@"toolbarItems"] = changedItems; changed[@"windowStyle"] = style;
  [manager applyToolbarItemsFromOptions:changed toWindow:window identifier:@"brightness-probe"];
  assert(![window.toolbar.items isEqualToArray:originalItems]);
  [window close];
  puts("Window manager controls passed");
} }
