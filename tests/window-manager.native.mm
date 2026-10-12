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
NSString *SparkNamespace(void) { return @"window-manager-tests"; }
extern "C" void SparkRebindWindowDelegate(NSWindow *, NSString *, id<NSWindowDelegate>) {}
static BOOL driverActive = NO;
static BOOL SparkTestDriverActive(void) { return driverActive; }
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
  // Toolbar display modes, shown state, sidebar item, overflow and its menu forms (#72).
  __block NSDictionary *toolbarState = nil;
  void (^readToolbar)(NSString *) = ^(NSString *windowId) {
    toolbarState = nil;
    [manager getWindowToolbarState:windowId resolve:^(id result) { toolbarState = [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
    assert(toolbarState);
  };
  NSWindow *bar = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1400, 500)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  bar.releasedWhenClosed = NO; manager.windows[@"bar"] = bar;
  error = nil;
  [manager getWindowToolbarState:@"bar" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { error = code; }];
  assert([error isEqual:@"E_NOT_FOUND"]);
  __block NSArray *barItems = @[
    @{ @"id": @"sidebar", @"type": @"sidebarToggle", @"placement": @"leading" },
    @{ @"id": @"view", @"type": @"segmented", @"label": @"View", @"selectedValue": @"list", @"segments": @[@{ @"value": @"list", @"label": @"List" }, @{ @"value": @"grid", @"label": @"Grid" }] },
    @{ @"id": @"sort", @"type": @"menuButton", @"label": @"Sort", @"menuItems": @[@{ @"id": @"name", @"title": @"Name", @"checked": @YES }, @{ @"id": @"date", @"title": @"Date" }] },
    @{ @"id": @"share", @"type": @"button", @"label": @"Share", @"systemImageName": @"square.and.arrow.up" },
    @{ @"id": @"status", @"type": @"label", @"label": @"Status", @"text": @"Ready" },
  ];
  [manager setWindowOptions:@"bar" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"hasToolbar": @YES, @"toolbarItems": barItems, @"toolbarDisplayMode": @"iconAndLabel", @"toolbarShown": @NO } }]
    resolve:^(id result) { assert([result containsString:@"true"]); } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(bar.toolbar.displayMode == NSToolbarDisplayModeIconAndLabel); assert(!bar.toolbar.visible); assert(!bar.toolbar.allowsUserCustomization);
  readToolbar(@"bar");
  assert([toolbarState[@"shown"] isEqual:@NO]); assert([toolbarState[@"displayMode"] isEqual:@"iconAndLabel"]); assert(toolbarState[@"customizationId"] == NSNull.null);
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view", @"sort", @"share", @"status"])]); assert([toolbarState[@"overflowItemIds"] count] == 0);
  // AppKit refuses label-only mode while a label item (nothing to click) is in the toolbar.
  error = nil;
  [manager setWindowOptions:@"bar" optionsJson:@"{\"windowStyle\":{\"toolbarDisplayMode\":\"label\"}}" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { error = code; }];
  assert([error isEqual:@"E_UNSUPPORTED_OPTION"]); assert(bar.toolbar.displayMode == NSToolbarDisplayModeIconAndLabel);
  barItems = [barItems subarrayWithRange:NSMakeRange(0, 4)];
  [manager setWindowOptions:@"bar" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": barItems, @"toolbarDisplayMode": @"label", @"toolbarShown": @YES } }]
    resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(bar.toolbar.displayMode == NSToolbarDisplayModeLabelOnly); assert(bar.toolbar.visible);
  readToolbar(@"bar");
  assert([toolbarState[@"displayMode"] isEqual:@"label"]); assert([toolbarState[@"shown"] isEqual:@YES]);
  [manager setWindowOptions:@"bar" optionsJson:@"{\"windowStyle\":{\"toolbarDisplayMode\":\"icon\"}}" resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"bar");
  assert([toolbarState[@"displayMode"] isEqual:@"icon"]); assert([toolbarState[@"overflowItemIds"] count] == 0);
  // AppKit's sidebar label and symbol, reported to JavaScript as a toolbarAction for its ID.
  NSToolbarItem *sidebarItem = bar.toolbar.items.firstObject;
  assert([sidebarItem.itemIdentifier isEqual:@"legend.toolbar.sidebar"]); assert([sidebarItem.label isEqual:@"Sidebar"]); assert(sidebarItem.image);
  assert(sidebarItem.target == manager); assert(sidebarItem.action == @selector(toolbarButtonItemPressed:));
  [manager toolbarButtonItemPressed:sidebarItem];
  assert([events.lastObject[@"type"] isEqual:@"toolbarAction"]); assert([events.lastObject[@"itemId"] isEqual:@"sidebar"]); assert([events.lastObject[@"windowId"] isEqual:@"bar"]);
  // A narrow window moves trailing items into the overflow menu; widening brings them back.
  [bar setFrame:NSMakeRect(0, 0, 360, 500) display:NO];
  readToolbar(@"bar");
  NSArray *overflow = toolbarState[@"overflowItemIds"];
  assert(overflow.count > 0 && overflow.count < 4); assert([overflow containsObject:@"share"]); assert(![overflow containsObject:@"sidebar"]);
  printf("Narrow toolbar overflow: %s\n", [[overflow componentsJoinedByString:@","] UTF8String]);
  [bar setFrame:NSMakeRect(0, 0, 1400, 500) display:NO];
  readToolbar(@"bar");
  assert([toolbarState[@"overflowItemIds"] count] == 0);
  // Menu forms used by the overflow menu and label-only mode: submenus built from current state.
  NSToolbarItem *viewItem = nil, *sortItem = nil;
  for (NSToolbarItem *item in bar.toolbar.items) {
    if ([item.itemIdentifier isEqual:@"legend.toolbar.view"]) viewItem = item;
    if ([item.itemIdentifier isEqual:@"legend.toolbar.sort"]) sortItem = item;
  }
  NSMenu *sortMenu = sortItem.menuFormRepresentation.submenu;
  assert([sortItem.menuFormRepresentation.title isEqual:@"Sort"]); assert(sortMenu);
  [sortMenu.delegate menuNeedsUpdate:sortMenu];
  assert(sortMenu.numberOfItems == 2); assert([[sortMenu itemAtIndex:0].title isEqual:@"Name"]); assert([sortMenu itemAtIndex:0].state == NSControlStateValueOn);
  NSMenuItem *dateItem = [sortMenu itemAtIndex:1];
  [manager performSelector:dateItem.action withObject:dateItem];
  assert([events.lastObject[@"type"] isEqual:@"toolbarMenuAction"]); assert([events.lastObject[@"action"][@"itemId"] isEqual:@"date"]);
  // A menu button without entries (a clickable readout) presses itself from the overflow menu.
  NSToolbarItem *elapsedItem = [manager toolbar:bar.toolbar itemForItemIdentifier:@"legend.toolbar.elapsed" willBeInsertedIntoToolbar:NO];
  assert(elapsedItem == nil);
  manager.toolbarItemConfigs[bar.toolbar.identifier] = [manager.toolbarItemConfigs[bar.toolbar.identifier] arrayByAddingObject:@{ @"id": @"elapsed", @"type": @"menuButton", @"label": @"0:00", @"menuItems": @[] }];
  elapsedItem = [manager toolbar:bar.toolbar itemForItemIdentifier:@"legend.toolbar.elapsed" willBeInsertedIntoToolbar:NO];
  assert(!elapsedItem.menuFormRepresentation.submenu); assert(elapsedItem.menuFormRepresentation.action);
  [manager performSelector:elapsedItem.menuFormRepresentation.action withObject:elapsedItem.menuFormRepresentation];
  assert([events.lastObject[@"type"] isEqual:@"toolbarAction"]); assert([events.lastObject[@"itemId"] isEqual:@"elapsed"]);
  NSMenu *viewMenu = viewItem.menuFormRepresentation.submenu;
  [viewMenu.delegate menuNeedsUpdate:viewMenu];
  assert(viewMenu.numberOfItems == 2); assert([[viewMenu itemAtIndex:1].title isEqual:@"Grid"]);
  assert([viewMenu itemAtIndex:0].state == NSControlStateValueOn && [viewMenu itemAtIndex:1].state == NSControlStateValueOff);
  NSMenuItem *gridItem = [viewMenu itemAtIndex:1];
  [manager performSelector:gridItem.action withObject:gridItem];
  assert([events.lastObject[@"type"] isEqual:@"toolbarSelectionChanged"]); assert([events.lastObject[@"value"] isEqual:@"grid"]);
  assert([(NSSegmentedControl *)viewItem.view selectedSegment] == 1);
  [viewMenu.delegate menuNeedsUpdate:viewMenu];
  assert([viewMenu itemAtIndex:1].state == NSControlStateValueOn);
  // The palette needs customization, and driver mode never shows it.
  error = nil;
  [manager runWindowToolbarCustomizationPalette:@"bar" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { error = code; }];
  assert([error isEqual:@"E_UNAVAILABLE"]);
  // Customization: the user's layout persists under the customization ID and restores in a new window.
  NSString *customId = [@"spark-test-" stringByAppendingString:NSUUID.UUID.UUIDString];
  NSString *defaultsKey = [@"window-manager-tests.toolbarLayout." stringByAppendingString:customId];
  NSWindow *(^customWindow)(NSString *, NSArray *) = ^NSWindow *(NSString *windowId, NSArray *items) {
    NSWindow *value = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1400, 500)
      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    value.releasedWhenClosed = NO; manager.windows[windowId] = value;
    [manager setWindowOptions:windowId optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"hasToolbar": @YES, @"toolbarItems": items, @"toolbarCustomization": customId } }]
      resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
    return value;
  };
  NSWindow *first = customWindow(@"custom-a", barItems);
  assert(first.toolbar.allowsUserCustomization); assert(!first.toolbar.autosavesConfiguration);
  readToolbar(@"custom-a");
  assert([toolbarState[@"customizationId"] isEqual:customId]); assert([toolbarState[@"itemIds"] count] == 4);
  // Opening applies the app's items without saving them as a customization.
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  assert([NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey] == nil);
  // App updates are not customizations: a new segmented value, a display mode, the shown state and new
  // items leave no saved layout, and until the user customizes, the toolbar follows the app's items.
  NSMutableArray *appItems = [barItems mutableCopy];
  NSMutableDictionary *grid = [appItems[1] mutableCopy]; grid[@"selectedValue"] = @"grid"; appItems[1] = grid;
  [appItems addObject:@{ @"id": @"export", @"type": @"button", @"label": @"Export" }];
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": appItems, @"toolbarDisplayMode": @"iconAndLabel", @"toolbarShown": @NO } }]
    resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": barItems, @"toolbarDisplayMode": @"icon", @"toolbarShown": @YES } }]
    resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  assert([NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey] == nil);
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": appItems } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"custom-a");
  assert([toolbarState[@"itemIds"] containsObject:@"export"]);
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  assert([NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey] == nil);
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": barItems } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  // The user hides the toolbar and picks Icon and Text: those are saved, the items are not, and
  // the app's item updates still apply.
  first.toolbar.visible = NO;
  first.toolbar.displayMode = NSToolbarDisplayModeIconAndLabel;
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  NSDictionary *viewOnly = [NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey];
  assert([viewOnly[@"shown"] isEqual:@NO]); assert([viewOnly[@"displayMode"] integerValue] == NSToolbarDisplayModeIconAndLabel);
  assert(viewOnly[@"items"] == nil);
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": appItems } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"custom-a");
  assert([toolbarState[@"itemIds"] containsObject:@"export"]);
  [manager setWindowOptions:@"custom-a" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": barItems } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"custom-a");
  assert(![toolbarState[@"itemIds"] containsObject:@"export"]);
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  assert([NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey][@"items"] == nil);
  first.toolbar.visible = YES;
  first.toolbar.displayMode = NSToolbarDisplayModeIconOnly;
  // The user drags Share out of the toolbar, picks Icon and Text and hides the toolbar (AppKit's
  // palette and context menu make these same toolbar changes).
  NSUInteger shareIndex = [[first.toolbar.items valueForKey:@"itemIdentifier"] indexOfObject:@"legend.toolbar.share"];
  [first.toolbar removeItemAtIndex:shareIndex];
  first.toolbar.displayMode = NSToolbarDisplayModeIconAndLabel;
  first.toolbar.visible = NO;
  NSDictionary *saved = [NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey];
  assert(![saved[@"items"] containsObject:@"legend.toolbar.share"]); assert([saved[@"shown"] isEqual:@NO]); assert([saved[@"displayMode"] integerValue] == NSToolbarDisplayModeIconAndLabel);
  // Closing a customizable window keeps the saved layout.
  [manager handleWindowClosedForIdentifier:@"custom-a" closeWindow:YES];
  assert([[NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey] isEqual:saved]);
  NSWindow *second = customWindow(@"custom-b", barItems);
  readToolbar(@"custom-b");
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view", @"sort"])]); assert([toolbarState[@"shown"] isEqual:@NO]);
  assert([toolbarState[@"displayMode"] isEqual:@"iconAndLabel"]);
  // Later item updates keep the user's arrangement: new items go to the palette, removed items leave.
  NSMutableArray *updatedItems = [[barItems subarrayWithRange:NSMakeRange(0, 2)] mutableCopy];
  [updatedItems addObject:@{ @"id": @"export", @"type": @"button", @"label": @"Export" }];
  [manager setWindowOptions:@"custom-b" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"toolbarItems": updatedItems } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"custom-b");
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view"])]);
  assert([[manager toolbarAllowedItemIdentifiers:second.toolbar] containsObject:@"legend.toolbar.export"]);
  // A second open window with the same ID restores the user's latest layout (the update was not
  // saved); each window then keeps its own.
  NSWindow *third = customWindow(@"custom-c", barItems);
  readToolbar(@"custom-c");
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view", @"sort"])]);
  // The user drags Share from the palette into the toolbar; the add is saved once AppKit has inserted it.
  [third.toolbar insertItemWithItemIdentifier:@"legend.toolbar.share" atIndex:2];
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  assert([[NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey][@"items"] containsObject:@"legend.toolbar.share"]);
  [third.toolbar removeItemAtIndex:0];
  readToolbar(@"custom-b");
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view"])]);
  [manager handleWindowClosedForIdentifier:@"custom-c" closeWindow:YES];
  // Turning customization off shows the app's items again and stops saving.
  [manager setWindowOptions:@"custom-b" optionsJson:@"{\"windowStyle\":{\"toolbarCustomization\":null}}" resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  readToolbar(@"custom-b");
  assert(toolbarState[@"customizationId"] == NSNull.null); assert(!second.toolbar.allowsUserCustomization);
  assert([toolbarState[@"itemIds"] isEqual:(@[@"sidebar", @"view", @"export"])]);
  NSDictionary *latest = [NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey];
  [second.toolbar removeItemAtIndex:0];
  assert([[NSUserDefaults.standardUserDefaults dictionaryForKey:defaultsKey] isEqual:latest]);
  [manager handleWindowClosedForIdentifier:@"custom-b" closeWindow:YES];
  [manager handleWindowClosedForIdentifier:@"bar" closeWindow:YES];
  [NSUserDefaults.standardUserDefaults removeObjectForKey:defaultsKey];
  puts("Toolbar customization, display modes, overflow and sidebar item passed");
  // AppKit groups (macos-adapter's windowStyle wire format) apply on update, then change back.
  NSWindow *chrome = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 480)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  chrome.releasedWhenClosed = NO; chrome.title = @"Chrome"; manager.windows[@"chrome"] = chrome;
  void (^apply)(NSDictionary *) = ^(NSDictionary *value) {
    __block BOOL applied = NO;
    [manager setWindowOptions:@"chrome" optionsJson:[manager jsonStringFromObject:value] resolve:^(id result) { applied = [result containsString:@"true"]; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
    assert(applied);
  };
  apply(@{ @"level": @(NSFloatingWindowLevel), @"representedURL": @"file:///Applications/", @"windowStyle": @{ @"trafficLights": @NO, @"titleVisibility": @"hidden",
    @"titlebarAppearsTransparent": @YES, @"hasToolbar": @YES, @"toolbarStyle": @"unifiedCompact", @"titlebarSeparatorStyle": @"none" } });
  assert(chrome.level == NSFloatingWindowLevel); assert([chrome.representedURL.path isEqual:@"/Applications"]); assert([chrome.title isEqual:@"Chrome"]);
  assert([chrome standardWindowButton:NSWindowCloseButton].hidden && [chrome standardWindowButton:NSWindowZoomButton].hidden);
  assert(chrome.titleVisibility == NSWindowTitleHidden); assert(chrome.titlebarAppearsTransparent);
  assert(chrome.toolbar != nil); assert(chrome.toolbarStyle == NSWindowToolbarStyleUnifiedCompact); assert(chrome.titlebarSeparatorStyle == NSTitlebarSeparatorStyleNone);
  apply(@{ @"level": @(NSNormalWindowLevel), @"representedURL": NSNull.null, @"windowStyle": @{ @"trafficLights": @YES, @"titleVisibility": @"visible",
    @"titlebarAppearsTransparent": @NO, @"hasToolbar": @NO } });
  assert(chrome.level == NSNormalWindowLevel); assert(!chrome.representedURL); assert(![chrome standardWindowButton:NSWindowCloseButton].hidden);
  assert(chrome.titleVisibility == NSWindowTitleVisible); assert(!chrome.titlebarAppearsTransparent); assert(!chrome.toolbar);
  // Special window types: the HUD panel style and the desktop level (never shown).
  NSPanel *hud = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  hud.releasedWhenClosed = NO; manager.windows[@"hud"] = hud;
  NSDictionary *constants = [NSJSONSerialization JSONObjectWithData:[[manager getConstantsJson] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  assert([constants[@"WINDOW_LEVEL_DESKTOP"] integerValue] == CGWindowLevelForKey(kCGDesktopWindowLevelKey) + 1);
  assert([constants[@"WINDOW_LEVEL_DESKTOP"] integerValue] < CGWindowLevelForKey(kCGDesktopIconWindowLevelKey));
  __block BOOL hudApplied = NO;
  [manager setWindowOptions:@"hud" optionsJson:[manager jsonStringFromObject:@{ @"level": constants[@"WINDOW_LEVEL_DESKTOP"], @"windowStyle": @{ @"panelStyle": @"hud" } }] resolve:^(id result) { hudApplied = [result containsString:@"true"]; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(hudApplied);
  assert((hud.styleMask & (NSWindowStyleMaskHUDWindow | NSWindowStyleMaskUtilityWindow | NSWindowStyleMaskTitled)) == (NSWindowStyleMaskHUDWindow | NSWindowStyleMaskUtilityWindow | NSWindowStyleMaskTitled));
  assert(!(hud.styleMask & NSWindowStyleMaskNonactivatingPanel)); assert(hud.level == CGWindowLevelForKey(kCGDesktopWindowLevelKey) + 1); assert(!hud.visible);
  assert(hud.hidesOnDeactivate);
  // A non-activating panel stays on screen while another app is active.
  [manager setWindowOptions:@"hud" optionsJson:[manager jsonStringFromObject:@{ @"windowStyle": @{ @"panelStyle": @"nonactivating" } }] resolve:^(id) {} reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(hud.styleMask & NSWindowStyleMaskNonactivatingPanel); assert(!(hud.styleMask & NSWindowStyleMaskHUDWindow)); assert(!hud.hidesOnDeactivate);
  [manager.windows removeObjectForKey:@"hud"]; [hud close];
  // Test driver mode records the window as shown without ordering it on screen.
  driverActive = YES;
  [manager showWindow:@"chrome" resolve:^(id result) { assert([result containsString:@"true"]); } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  assert(!chrome.visible && SparkDriverShown(chrome));
  driverActive = NO;
  [manager.windows removeObjectForKey:@"chrome"]; [chrome close];
  puts("Window manager controls passed");
} }
