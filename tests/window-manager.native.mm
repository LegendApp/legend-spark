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
extern "C" void SparkRebindWindowDelegate(NSWindow *, NSString *, id<NSWindowDelegate>) {}
// ACTUAL_IMPLEMENTATION
extern "C" void LegendPrepareSidebarSplitViewStartup(NSWindow *, NSDictionary *) {}
extern "C" BOOL LegendAttachSidebarSplitViewStartupRoot(NSWindow *, NSView *, void (^)(void)) { return NO; }
extern "C" void LegendFinishSidebarSplitViewStartup(NSWindow *) {}
int main() { @autoreleasepool {
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
