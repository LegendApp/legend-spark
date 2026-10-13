#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cassert>
#include <memory>
#include <mach/mach.h>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeDesktopWindowManagerSpecJSI : TurboModule { NativeDesktopWindowManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
}
@interface RNDesktopWindows : NSObject
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
@interface TestSurface : NSObject
- (void)stop;
@end
@implementation TestSurface
- (void)stop {}
@end
@interface RCTSurfaceHostingView : NSView
@property TestSurface *surface;
@end
@implementation RCTSurfaceHostingView @end
@interface RCTRootView : NSView
@property (copy) NSDictionary *appProperties;
@end
@implementation RCTRootView @end
static NSMutableArray *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event]; }
static NSString *SparkNamespace() { return @"window-tests"; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static BOOL driverActive = NO;
static BOOL SparkTestDriverActive(void) { return driverActive; }
typedef void (^SparkTestDriverReply)(NSDictionary *reply);
typedef void (^SparkTestDriverHandler)(NSDictionary *request, SparkTestDriverReply reply);
static NSMutableDictionary<NSString *, SparkTestDriverHandler> *driverCommands;
static void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler) { if (!driverCommands) driverCommands = [NSMutableDictionary new]; driverCommands[name] = handler; }
static NSDictionary *simulatedState;  // the last SparkTestDriverDidSimulateState report (motion follows it)
typedef void (^SparkTestDriverStateObserver)(NSDictionary *values);
static NSMutableArray<SparkTestDriverStateObserver> *stateObservers;
static void SparkTestDriverObserveSimulatedState(SparkTestDriverStateObserver observer) { if (!stateObservers) stateObservers = [NSMutableArray new]; [stateObservers addObject:observer]; }
static void SparkTestDriverDidSimulateState(NSDictionary *values) { simulatedState = values; for (SparkTestDriverStateObserver observer in stateObservers) observer(values); }
// Motion's virtual clock, as the driver reports it to window choreography.
typedef void (^SparkTestDriverClockObserver)(BOOL virtualClock, double advancedMs);
static NSMutableArray<SparkTestDriverClockObserver> *clockObservers;
static void SparkTestDriverObserveClock(SparkTestDriverClockObserver observer) { if (!clockObservers) clockObservers = [NSMutableArray new]; [clockObservers addObject:observer]; }
static void DriverClock(BOOL virtualClock, double advancedMs) { for (SparkTestDriverClockObserver observer in clockObservers) observer(virtualClock, advancedMs); }
// ACTUAL_IMPLEMENTATION
@interface TestWindow : NSObject
@property (weak) id<NSWindowDelegate> delegate;
@property NSView *contentView;
@property NSWindow *sheetParent;
@property NSWindow *parentWindow;
@property NSRect frame;
@property BOOL closed;
- (void)close;
@end
@implementation TestWindow
- (void)close { self.closed = YES; [self.delegate windowWillClose:[NSNotification notificationWithName:NSWindowWillCloseNotification object:self]]; }
@end
static void Pump() { for (int i=0; i<20; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]]; }
static NSString *failure = nil, *reply = nil;
static void Call(RNDesktopWindows *api, NSString *method, NSDictionary *args) {
  failure = nil; reply = nil; [api call:method args:SparkJSON(args) resolve:^(id value) { reply = value; } reject:^(NSString *code, NSString *, NSError *) { failure = code; }]; Pump();
}
static BOOL OnScreen(NSWindow *window) {
  CFArrayRef ids = CFArrayCreate(NULL, (const void *[]){ (void *)(uintptr_t)window.windowNumber }, 1, NULL);
  NSArray *info = CFBridgingRelease(CGWindowListCreateDescriptionFromArray(ids)); CFRelease(ids);
  return window.visible || [info.firstObject[(id)kCGWindowIsOnscreen] boolValue];
}
static BOOL ReportedVisible(RNDesktopWindows *api, NSString *key) {
  Call(api, @"info", @{ @"id": key }); assert(!failure);
  return [SparkArgs(reply)[@"visible"] boolValue];
}
// Close button's leading top corner, measured from the window's leading top corner.
static NSPoint CloseButtonOffset(NSWindow *window) {
  NSButton *close = [window standardWindowButton:NSWindowCloseButton]; NSRect rect = [close convertRect:close.bounds toView:nil];
  BOOL rtl = window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  return NSMakePoint(rtl ? NSWidth(window.frame) - NSMaxX(rect) : NSMinX(rect), NSHeight(window.frame) - NSMaxY(rect));
}
// The window server's sharing state: AppKit's sharingType getter keeps None after a change back to ReadOnly.
static NSInteger Sharing(NSWindow *window) {
  CFArrayRef ids = CFArrayCreate(NULL, (const void *[]){ (void *)(uintptr_t)window.windowNumber }, 1, NULL);
  NSArray *info = CFBridgingRelease(CGWindowListCreateDescriptionFromArray(ids)); CFRelease(ids);
  return [info.firstObject[(id)kCGWindowSharingState] integerValue];
}
static NSVisualEffectView *Material(NSWindow *window) {
  for (NSView *view in window.contentView.subviews) if ([view isKindOfClass:NSVisualEffectView.class]) return (NSVisualEffectView *)view;
  return nil;
}
// A window AppKit leaves where it is put: ordering a window front normally moves it back onto a screen.
@interface OffscreenWindow : NSWindow @end
@implementation OffscreenWindow
- (NSRect)constrainFrameRect:(NSRect)frame toScreen:(NSScreen *)screen { return frame; }
@end
static NSWindow *RealWindow(NSString *key, Class type = NSWindow.class) {
  NSWindow *window = [[type alloc] initWithContentRect:NSMakeRect(200, 200, 640, 480) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO; windows[key] = window; return window;
}
// Every option is applied at open, then changed on the live window. Windows are never shown.
static void TestWindowOptions(RNDesktopWindows *api) {
  [NSApplication sharedApplication];
  NSWindow *window = RealWindow(@"options");
  Call(api, @"completeOpen", @{ @"id": @"options", @"show": @NO, @"size": @{ @"width": @700, @"height": @500 }, @"title": @"Options",
    @"resizable": @NO, @"closable": @NO, @"minimizable": @NO, @"alwaysOnTop": @YES, @"hasShadow": @NO, @"backgroundColor": @"#3366CC",
    @"minSize": @{ @"width": @400, @"height": @300 }, @"maxSize": @{ @"width": @1200, @"height": @900 }, @"titleBarStyle": @"overlay",
    @"aspectRatio": @1.5, @"opacity": @0.5, @"contentProtection": @YES, @"ignoreMouseEvents": @YES,
    @"macos": @{ @"spaces": @"all", @"documentEdited": @YES, @"backgroundMaterial": @"sidebar", @"titleBar": @{ @"subtitle": @"Draft", @"trafficLightPosition": @{ @"x": @20, @"y": @18 } } } });
  assert(!failure);
  assert(!(window.styleMask & (NSWindowStyleMaskResizable | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable)));
  assert(window.styleMask & NSWindowStyleMaskFullSizeContentView); assert(window.titlebarAppearsTransparent); assert(window.titleVisibility == NSWindowTitleHidden);
  assert(window.level == NSFloatingWindowLevel); assert(!window.hasShadow);
  NSColor *color = [window.backgroundColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  assert(fabs(color.redComponent - 0x33 / 255.0) < 0.01 && fabs(color.blueComponent - 0xCC / 255.0) < 0.01);
  assert(NSEqualSizes(window.minSize, NSMakeSize(400, 300))); assert(NSEqualSizes(window.maxSize, NSMakeSize(1200, 900)));
  assert(NSEqualSizes(window.frame.size, NSMakeSize(700, 500)));
  assert(window.contentAspectRatio.width / window.contentAspectRatio.height == 1.5);
  assert(fabs(window.alphaValue - 0.5) < 0.001); assert(Sharing(window) == kCGWindowSharingNone); assert(window.ignoresMouseEvents);
  assert(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces); assert(window.documentEdited); assert([window.subtitle isEqual:@"Draft"]);
  assert(Material(window).material == NSVisualEffectMaterialSidebar); assert(Material(window).blendingMode == NSVisualEffectBlendingModeBehindWindow);
  assert(window.contentView.subviews.firstObject == Material(window));
  // With closable, minimizable and resizable off AppKit removes the buttons; the position applies once they return.
  assert(![window standardWindowButton:NSWindowCloseButton]);
  Call(api, @"options", @{ @"id": @"options", @"options": @{ @"resizable": @YES, @"closable": @YES, @"minimizable": @YES } }); assert(!failure);
  assert(NSEqualPoints(CloseButtonOffset(window), NSMakePoint(20, 18)));
  // AppKit lays the title bar out again on resize and toolbar changes; the position holds.
  [window setFrame:NSInsetRect(window.frame, -40, -30) display:NO]; assert(NSEqualPoints(CloseButtonOffset(window), NSMakePoint(20, 18)));
  window.toolbar = [[NSToolbar alloc] initWithIdentifier:@"options"]; [window.contentView.superview layoutSubtreeIfNeeded]; Pump();
  assert(NSEqualPoints(CloseButtonOffset(window), NSMakePoint(20, 18)));
  window.toolbar = nil;
  // Right-to-left title bars (run with -NSForceRightToLeftWritingDirection YES) mirror the buttons.
  if (window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft)
    assert(NSMinX([window standardWindowButton:NSWindowZoomButton].frame) < NSMinX([window standardWindowButton:NSWindowCloseButton].frame));

  // Updates publish only the fields they name.
  Call(api, @"options", @{ @"id": @"options", @"options": @{ @"opacity": @0.8 } });
  assert(!failure); assert(fabs(window.alphaValue - 0.8) < 0.001); assert(Sharing(window) == kCGWindowSharingNone); assert(window.level == NSFloatingWindowLevel);
  Call(api, @"options", @{ @"id": @"options", @"options": @{ @"alwaysOnTop": @NO, @"hasShadow": @YES,
    @"transparent": @NO, @"minSize": NSNull.null, @"maxSize": NSNull.null, @"titleBarStyle": @"default", @"aspectRatio": NSNull.null, @"opacity": @1,
    @"contentProtection": @NO, @"ignoreMouseEvents": @NO,
    @"macos": @{ @"spaces": @"active", @"documentEdited": @NO, @"backgroundMaterial": @"none", @"titleBar": @{ @"subtitle": @"", @"trafficLightPosition": NSNull.null } } } });
  assert(!failure);
  assert((window.styleMask & (NSWindowStyleMaskResizable | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable)) == (NSWindowStyleMaskResizable | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable));
  assert(!(window.styleMask & NSWindowStyleMaskFullSizeContentView)); assert(window.titleVisibility == NSWindowTitleVisible);
  assert(window.level == NSNormalWindowLevel); assert(window.hasShadow); assert(window.opaque);
  assert(NSEqualSizes(window.minSize, NSMakeSize(100, 100))); assert(NSEqualSizes(window.maxSize, NSMakeSize(20000, 20000)));
  assert(NSEqualSizes(window.contentAspectRatio, NSZeroSize)); assert(window.alphaValue == 1);
  assert(Sharing(window) == kCGWindowSharingReadOnly); assert(!window.ignoresMouseEvents);
  assert(!(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces)); assert(window.collectionBehavior & NSWindowCollectionBehaviorMoveToActiveSpace);
  assert(!window.documentEdited); assert(window.subtitle.length == 0); assert(!Material(window));
  NSPoint appKit = CloseButtonOffset(window); assert(appKit.x < 20 && appKit.y < 18);
  Call(api, @"options", @{ @"id": @"options", @"options": @{ @"macos": @{ @"spaces": @"default" } } });
  assert(!(window.collectionBehavior & (NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorMoveToActiveSpace)));

  // Simple fullscreen covers the screen; restoreBounds and frame autosave keep the windowed frame.
  NSString *boundsKey = @"window-tests.bounds.restoring";
  NSWindow *restoring = RealWindow(@"restoring");
  Call(api, @"completeOpen", @{ @"id": @"restoring", @"show": @NO, @"size": @{ @"width": @640, @"height": @400 }, @"restoreBounds": @YES }); assert(!failure);
  [restoring setFrameAutosaveName:@"spark-window-options-test"];
  [restoring setFrame:NSOffsetRect(restoring.frame, 10, 0) display:NO];
  NSRect windowed = restoring.frame; NSDictionary *saved = [NSUserDefaults.standardUserDefaults dictionaryForKey:boundsKey];
  NSString *autosaved = [NSUserDefaults.standardUserDefaults stringForKey:@"NSWindow Frame spark-window-options-test"];
  assert(saved && autosaved);
  Call(api, @"options", @{ @"id": @"restoring", @"options": @{ @"macos": @{ @"simpleFullscreen": @YES } } }); assert(!failure);
  assert(NSEqualRects(restoring.frame, (restoring.screen ?: NSScreen.mainScreen).frame));
  assert(!restoring.movable && !(restoring.styleMask & NSWindowStyleMaskResizable) && [restoring standardWindowButton:NSWindowCloseButton].hidden);
  assert(NSApp.presentationOptions & NSApplicationPresentationAutoHideMenuBar);
  assert([[NSUserDefaults.standardUserDefaults dictionaryForKey:boundsKey] isEqual:saved]);
  assert([[NSUserDefaults.standardUserDefaults stringForKey:@"NSWindow Frame spark-window-options-test"] isEqual:autosaved]);
  for (NSDictionary *busy in @[@{ @"titleBarStyle": @"hidden" }, @{ @"resizable": @YES }, @{ @"macos": @{ @"titleBar": @{ @"trafficLights": @NO } } }]) {
    Call(api, @"options", @{ @"id": @"restoring", @"options": busy }); assert([failure isEqual:@"E_BUSY"]);
  }
  Call(api, @"options", @{ @"id": @"restoring", @"options": @{ @"macos": @{ @"titleBar": @{ @"subtitle": @"Allowed" } } } }); assert(!failure);
  Call(api, @"bounds", @{ @"id": @"restoring", @"bounds": SparkBoundsForWindow(restoring) }); assert([failure isEqual:@"E_BUSY"]);
  Call(api, @"options", @{ @"id": @"restoring", @"options": @{ @"macos": @{ @"simpleFullscreen": @NO } } }); assert(!failure);
  assert(NSEqualRects(restoring.frame, windowed)); assert(restoring.movable && (restoring.styleMask & NSWindowStyleMaskResizable));
  assert(![restoring standardWindowButton:NSWindowCloseButton].hidden && restoring.titleVisibility == NSWindowTitleVisible);
  assert(!(NSApp.presentationOptions & NSApplicationPresentationAutoHideMenuBar));
  assert([restoring.frameAutosaveName isEqual:@"spark-window-options-test"]);
  // Closing in simple fullscreen gives back the presentation options.
  Call(api, @"options", @{ @"id": @"restoring", @"options": @{ @"macos": @{ @"simpleFullscreen": @YES } } }); assert(!failure);
  [restoring close]; Pump();
  assert(!(NSApp.presentationOptions & NSApplicationPresentationAutoHideMenuBar));
  [window close]; Pump();
  // The harness has no bundle: its defaults domain is the executable's name.
  [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSProcessInfo.processInfo.processName];
  printf("Window options passed (%s)\n", window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft ? "right-to-left" : "left-to-right");
}
// Test driver mode never puts a window on screen; the window API still reports what the app showed.
static void TestDriverMode(RNDesktopWindows *api) {
  driverActive = YES;
  NSWindow *parent = RealWindow(@"driver-parent"), *window = RealWindow(@"driver"), *sheet = RealWindow(@"driver-sheet");
  Call(api, @"completeOpen", @{ @"id": @"driver-parent", @"size": @{ @"width": @500, @"height": @400 } }); assert(!failure);
  Call(api, @"completeOpen", @{ @"id": @"driver", @"parentId": @"driver-parent", @"size": @{ @"width": @400, @"height": @300 }, @"opacity": @0.5, @"macos": @{ @"documentEdited": @YES } }); assert(!failure);
  assert(!OnScreen(parent) && !OnScreen(window)); assert(window.parentWindow == parent);
  assert(window.alphaValue == 0.5 && window.documentEdited && NSEqualSizes(window.frame.size, NSMakeSize(400, 300)));
  assert(ReportedVisible(api, @"driver")); assert([events.lastObject[@"visible"] isEqual:@YES]);
  Call(api, @"hide", @{ @"id": @"driver" }); assert(!failure && !ReportedVisible(api, @"driver")); assert([events.lastObject[@"visible"] isEqual:@NO]);
  for (NSNumber *focus in @[@NO, @YES]) {
    Call(api, @"show", @{ @"id": @"driver", @"focus": focus }); assert(!failure && ReportedVisible(api, @"driver") && !OnScreen(window));
  }
  Call(api, @"completeOpen", @{ @"id": @"driver-sheet", @"parentId": @"driver-parent", @"modal": @YES, @"kind": @"window" }); assert(!failure);
  assert(!OnScreen(sheet) && !sheet.sheetParent && ReportedVisible(api, @"driver-sheet"));
  Call(api, @"fullscreen", @{ @"id": @"driver", @"enabled": @YES }); assert([failure isEqual:@"E_UNSUPPORTED_OPTION"] && !OnScreen(window));
  Call(api, @"options", @{ @"id": @"driver", @"options": @{ @"macos": @{ @"simpleFullscreen": @YES } } }); assert(!failure && !OnScreen(window));
  Call(api, @"options", @{ @"id": @"driver", @"options": @{ @"macos": @{ @"simpleFullscreen": @NO } } }); assert(!failure);
  for (NSWindow *opened in @[sheet, window, parent]) [opened close];
  Pump(); driverActive = NO;
  puts("Driver mode windows stayed off screen");
}
// The window IDs of a window's NSWindow tab group, in tab order (just the window when it is not tabbed).
static NSArray *GroupIds(NSWindow *window) {
  NSMutableArray *ids = [NSMutableArray new];
  for (NSWindow *tab in TabWindows(window)) [ids addObject:KeyFor(tab) ?: @"?"];
  return ids;
}
static NSString *SelectedId(NSWindow *window) { return KeyFor(SelectedTab(window)); }
static NSDictionary *LastEvent(NSString *type, NSString *key) {
  for (NSDictionary *event in events.reverseObjectEnumerator) if ([event[@"type"] isEqual:type] && [event[@"windowId"] isEqual:key]) return event;
  return nil;
}
// Native window tabs in driver mode: every operation regroups real NSWindows that are never on screen.
static void TestWindowTabs(RNDesktopWindows *api) {
  driverActive = YES;
  NSDictionary *docs = @{ @"mode": @"preferred", @"identifier": @"docs" };
  NSWindow *one = RealWindow(@"tab-1"), *two = RealWindow(@"tab-2"), *three = RealWindow(@"tab-3");
  Call(api, @"completeOpen", @{ @"id": @"tab-1", @"tabbing": docs }); assert(!failure);
  assert(one.tabbingMode == NSWindowTabbingModePreferred && [one.tabbingIdentifier isEqual:@"docs"]);
  Call(api, @"completeOpen", @{ @"id": @"tab-2", @"tabbedWith": @"tab-1" }); assert(!failure);
  Call(api, @"completeOpen", @{ @"id": @"tab-3", @"tabbedWith": @"tab-1" }); assert(!failure);
  // New tabs are the group's last tab, take its tabbing identifier, and are selected.
  assert([GroupIds(one) isEqual:(@[@"tab-1", @"tab-2", @"tab-3"])] && one.tabGroup == three.tabGroup && [three.tabbingIdentifier isEqual:@"docs"]);
  assert([SelectedId(one) isEqual:@"tab-3"] && one.tabGroup.tabBarVisible);
  Call(api, @"tabGroup", @{ @"id": @"tab-2" }); assert(!failure);
  assert([SparkArgs(reply) isEqual:(@{ @"windowIds": @[@"tab-1", @"tab-2", @"tab-3"], @"selectedWindowId": @"tab-3", @"tabBarVisible": @YES })]);
  NSDictionary *changed = LastEvent(@"tabGroupChanged", @"tab-1");
  assert([changed[@"tabGroup"][@"windowIds"] isEqual:(@[@"tab-1", @"tab-2", @"tab-3"])] && [changed[@"instanceId"] isEqual:delegates[@"tab-1"].instanceId]);
  assert([LastEvent(@"tabSelectionChanged", @"tab-2")[@"selectedWindowId"] isEqual:@"tab-3"]);
  for (NSDictionary *invalid in @[@{ @"tabbedWith": @"missing" }, @{ @"tabbedWith": @"tab-1", @"tabbing": @{ @"identifier": @"other" } }, @{ @"tabbedWith": @"tab-1", @"tabbing": @{ @"mode": @"disallowed" } }]) {
    NSMutableDictionary *args = [invalid mutableCopy]; args[@"id"] = @"tab-invalid"; RealWindow(@"tab-invalid");
    Call(api, @"completeOpen", args); assert([failure isEqual:[invalid[@"tabbedWith"] isEqual:@"missing"] ? @"E_NOT_FOUND" : @"E_INVALID_ARGUMENT"]);
    assert([GroupIds(one) isEqual:(@[@"tab-1", @"tab-2", @"tab-3"])]);
    [windows[@"tab-invalid"] close]; [windows removeObjectForKey:@"tab-invalid"];
  }

  [events removeAllObjects];
  Call(api, @"selectTab", @{ @"id": @"tab-1" }); assert(!failure && [SelectedId(three) isEqual:@"tab-1"]);
  assert([LastEvent(@"tabSelectionChanged", @"tab-3")[@"selectedWindowId"] isEqual:@"tab-1"] && !LastEvent(@"tabGroupChanged", @"tab-3"));
  Call(api, @"tabBar", @{ @"id": @"tab-1", @"visible": @NO }); assert([failure isEqual:@"E_BUSY"] && one.tabGroup.tabBarVisible);

  // Move Tab to New Window regroups without ordering the window on screen; moving a lone window changes nothing.
  Call(api, @"moveTabToNewWindow", @{ @"id": @"tab-2" }); assert(!failure);
  assert([GroupIds(one) isEqual:(@[@"tab-1", @"tab-3"])] && [GroupIds(two) isEqual:@[@"tab-2"]] && !OnScreen(two));
  assert([LastEvent(@"tabGroupChanged", @"tab-2")[@"tabGroup"] isEqual:(@{ @"windowIds": @[@"tab-2"], @"selectedWindowId": @"tab-2", @"tabBarVisible": @NO })]);
  assert([LastEvent(@"tabGroupChanged", @"tab-3")[@"tabGroup"][@"windowIds"] isEqual:(@[@"tab-1", @"tab-3"])]);
  Call(api, @"moveTabToNewWindow", @{ @"id": @"tab-2" }); assert(!failure && [GroupIds(two) isEqual:@[@"tab-2"]]);

  // Merge All Windows joins every shown window with the same identifier, in creation order; hidden and other windows stay.
  NSWindow *four = RealWindow(@"tab-4"), *other = RealWindow(@"tab-other"), *hidden = RealWindow(@"tab-hidden"), *single = RealWindow(@"tab-single");
  Call(api, @"completeOpen", @{ @"id": @"tab-4", @"tabbing": docs }); assert(!failure);
  Call(api, @"completeOpen", @{ @"id": @"tab-other", @"tabbing": @{ @"identifier": @"other" } }); assert(!failure);
  Call(api, @"completeOpen", @{ @"id": @"tab-hidden", @"tabbing": docs, @"show": @NO }); assert(!failure);
  Call(api, @"completeOpen", @{ @"id": @"tab-single", @"tabbing": @{ @"mode": @"disallowed" } }); assert(!failure);
  RealWindow(@"tab-invalid"); Call(api, @"completeOpen", @{ @"id": @"tab-invalid", @"tabbedWith": @"tab-hidden" });
  assert([failure isEqual:@"E_INVALID_ARGUMENT"] && [GroupIds(hidden) isEqual:@[@"tab-hidden"]]); // A hidden window cannot take a tab.
  [windows[@"tab-invalid"] close]; [windows removeObjectForKey:@"tab-invalid"];
  assert([GroupIds(four) isEqual:@[@"tab-4"]]); // Driver mode never orders windows front, so AppKit's automatic tabbing never runs.
  Call(api, @"mergeAllWindows", @{ @"id": @"tab-1" }); assert(!failure);
  assert([GroupIds(one) isEqual:(@[@"tab-1", @"tab-3", @"tab-2", @"tab-4"])] && [GroupIds(other) isEqual:@[@"tab-other"]] && [GroupIds(hidden) isEqual:@[@"tab-hidden"]]);
  // Windows that changed groups (tab-2 moved out earlier, tab-4 was alone) keep observing their new group.
  for (NSString *key in @[@"tab-2", @"tab-4"]) assert([LastEvent(@"tabGroupChanged", key)[@"tabGroup"][@"windowIds"] isEqual:(@[@"tab-1", @"tab-3", @"tab-2", @"tab-4"])]);
  Call(api, @"selectTab", @{ @"id": @"tab-4" }); assert(!failure);
  assert([LastEvent(@"tabSelectionChanged", @"tab-2")[@"selectedWindowId"] isEqual:@"tab-4"]);
  Call(api, @"selectTab", @{ @"id": @"tab-1" }); assert(!failure);
  Call(api, @"tabGroups", @{}); assert(!failure);
  NSArray *groups = (NSArray *)SparkArgs(reply);
  assert([groups containsObject:(@{ @"windowIds": @[@"tab-1", @"tab-3", @"tab-2", @"tab-4"], @"selectedWindowId": @"tab-1", @"tabBarVisible": @YES })]);
  NSUInteger listed = 0; for (NSDictionary *group in groups) listed += [group[@"windowIds"] count];
  NSUInteger real = 0; for (NSString *key in windows) real += [windows[key] isKindOfClass:NSWindow.class];
  assert(listed == real); // Every Spark window is in exactly one listed group.
  Call(api, @"mergeAllWindows", @{ @"id": @"tab-single" }); assert([failure isEqual:@"E_INVALID_ARGUMENT"]);

  // Show/Hide Tab Bar applies to a window without other tabs.
  Call(api, @"tabBar", @{ @"id": @"tab-other", @"visible": @YES }); assert(!failure && other.tabGroup.tabBarVisible);
  assert([LastEvent(@"tabGroupChanged", @"tab-other")[@"tabGroup"][@"tabBarVisible"] isEqual:@YES]);
  Call(api, @"tabBar", @{ @"id": @"tab-other", @"visible": @NO }); assert(!failure && !other.tabGroup.tabBarVisible);
  Call(api, @"tabBar", @{ @"id": @"tab-single", @"visible": @YES }); assert([failure isEqual:@"E_INVALID_ARGUMENT"]);

  // Hiding a tab takes it out of its group, as AppKit does.
  Call(api, @"hide", @{ @"id": @"tab-3" }); assert(!failure && [GroupIds(one) isEqual:(@[@"tab-1", @"tab-2", @"tab-4"])]);

  // The + button: the delegate answers newWindowForTab: only while a handler is registered.
  assert(![one respondsToSelector:@selector(newWindowForTab:)] || ![delegates[@"tab-1"] respondsToSelector:@selector(newWindowForTab:)]);
  Call(api, @"newTab", @{ @"id": @"tab-1", @"handlerId": @"plus", @"enabled": @YES }); assert(!failure);
  assert([NSApp targetForAction:@selector(newWindowForTab:) to:nil from:one] == delegates[@"tab-1"]);
  assert([one tryToPerform:@selector(newWindowForTab:) with:nil]);
  assert([events.lastObject isEqual:(@{ @"type": @"newTabRequested", @"windowId": @"tab-1", @"instanceId": delegates[@"tab-1"].instanceId, @"handlerId": @"plus" })]);
  Call(api, @"newTab", @{ @"id": @"tab-1", @"handlerId": @"second", @"enabled": @YES }); assert([failure isEqual:@"E_BUSY"]);
  Call(api, @"newTab", @{ @"id": @"tab-1", @"handlerId": @"second", @"enabled": @NO }); assert(!failure && delegates[@"tab-1"].tabHandlerId);
  Call(api, @"newTab", @{ @"id": @"tab-1", @"handlerId": @"plus", @"enabled": @NO }); assert(!failure);
  assert(![delegates[@"tab-1"] respondsToSelector:@selector(newWindowForTab:)] && ![one tryToPerform:@selector(newWindowForTab:) with:nil]);

  // Closing a tab publishes the smaller group to the others.
  [events removeAllObjects];
  Call(api, @"close", @{ @"id": @"tab-2" }); assert(!failure);
  assert([LastEvent(@"tabGroupChanged", @"tab-1")[@"tabGroup"][@"windowIds"] isEqual:(@[@"tab-1", @"tab-4"])]);
  // Closing the group's tabs, AppKit's selected one first, never puts the next tab on screen.
  for (NSString *key in @[@"tab-1", @"tab-3", @"tab-4", @"tab-other", @"tab-hidden", @"tab-single"]) {
    Call(api, @"close", @{ @"id": key }); assert(!failure);
    for (NSWindow *window in @[one, two, three, four, other, hidden, single]) assert(!OnScreen(window));
  }
  Pump(); driverActive = NO;
  puts("Window tabs passed");
}
// restoreBounds saves each window's tab group; reopened windows rejoin it in the saved order and selection.
static void TestTabRestoration(RNDesktopWindows *api) {
  NSArray *ids = @[@"restore-a", @"restore-b", @"restore-c"];
  NSMutableArray<NSWindow *> *opened = [NSMutableArray new];
  // Driver mode ignores restoreBounds, so the windows open outside it, hidden; the user's tab arrangement is
  // then applied in driver mode, where selecting a tab keeps it off screen.
  for (NSString *key in ids) { [opened addObject:RealWindow(key)]; Call(api, @"completeOpen", @{ @"id": key, @"show": @NO, @"restoreBounds": @YES, @"tabbing": @{ @"identifier": @"restore" } }); assert(!failure); }
  driverActive = YES;
  [opened[0] addTabbedWindow:opened[2] ordered:NSWindowAbove]; [opened[2] addTabbedWindow:opened[1] ordered:NSWindowAbove];
  SelectTab(opened[2]); Pump();
  assert([GroupIds(opened[0]) isEqual:(@[@"restore-a", @"restore-c", @"restore-b"])]);
  NSMutableDictionary *saved = [NSMutableDictionary new];
  for (NSString *key in ids) {
    NSDictionary *record = [NSUserDefaults.standardUserDefaults dictionaryForKey:SavedStateKey(key)];
    assert([record[@"tabs"] isEqual:(@[@"restore-a", @"restore-c", @"restore-b"])] && [record[@"selected"] isEqual:@([key isEqual:@"restore-c"])] && record[@"bounds"]);
    saved[key] = record;
  }
  // A window the user closes leaves its saved group.
  Call(api, @"close", @{ @"id": @"restore-b" }); assert(!failure); Pump();
  assert(![[NSUserDefaults.standardUserDefaults dictionaryForKey:SavedStateKey(@"restore-b")] objectForKey:@"tabs"]);
  assert([[NSUserDefaults.standardUserDefaults dictionaryForKey:SavedStateKey(@"restore-a")][@"tabs"] isEqual:(@[@"restore-a", @"restore-c"])]);
  for (NSString *key in @[@"restore-a", @"restore-c"]) { Call(api, @"close", @{ @"id": key }); assert(!failure); }
  for (NSWindow *window in opened) assert(!OnScreen(window));
  // Next launch: the records written before quitting. Windows reopen in another order and rejoin as they are shown.
  for (NSString *key in ids) [NSUserDefaults.standardUserDefaults setObject:saved[key] forKey:SavedStateKey(key)];
  driverActive = NO;
  NSMutableDictionary<NSString *, NSWindow *> *restored = [NSMutableDictionary new];
  for (NSString *key in @[@"restore-b", @"restore-c", @"restore-a"]) { restored[key] = RealWindow(key); Call(api, @"completeOpen", @{ @"id": key, @"show": @NO, @"restoreBounds": @YES, @"tabbing": @{ @"identifier": @"restore" } }); assert(!failure); }
  driverActive = YES; // Presenting in driver mode keeps the windows off screen.
  Call(api, @"show", @{ @"id": @"restore-b" }); assert(!failure && [GroupIds(restored[@"restore-b"]) isEqual:@[@"restore-b"]]);
  Call(api, @"show", @{ @"id": @"restore-a" }); assert(!failure && [GroupIds(restored[@"restore-b"]) isEqual:(@[@"restore-a", @"restore-b"])] && [SelectedId(restored[@"restore-a"]) isEqual:@"restore-b"]);
  Call(api, @"show", @{ @"id": @"restore-c" }); assert(!failure);
  assert([GroupIds(restored[@"restore-a"]) isEqual:(@[@"restore-a", @"restore-c", @"restore-b"])] && [SelectedId(restored[@"restore-a"]) isEqual:@"restore-c"]);
  // Closing tabs, the selected one first, never puts the next tab on screen.
  for (NSString *key in @[@"restore-c", @"restore-a", @"restore-b"]) { Call(api, @"close", @{ @"id": key }); assert(!failure); for (NSWindow *window in restored.allValues) assert(!OnScreen(window)); }
  Pump(); driverActive = NO;
  [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSProcessInfo.processInfo.processName];
  puts("Window tab restoration passed");
}
// Outside driver mode a new tab joins its group once shown: AppKit keeps only shown windows in tab groups.
// The windows are fully transparent, off every screen, and never activate the app, so nothing appears.
static void TestShownTabs(RNDesktopWindows *api) {
  NSScreen *primary = SparkPrimaryScreen();
  NSDictionary *offscreen = @{ @"displayId": SparkScreenId(primary), @"x": @(-4 * NSWidth(primary.frame)), @"y": @0 };
  NSWindow *first = RealWindow(@"shown-1", OffscreenWindow.class), *second = RealWindow(@"shown-2", OffscreenWindow.class);
  NSDictionary *unseen = @{ @"opacity": @0, @"ignoreMouseEvents": @YES, @"position": offscreen };
  NSMutableDictionary *one = [unseen mutableCopy], *two = [unseen mutableCopy];
  [one addEntriesFromDictionary:@{ @"id": @"shown-1", @"tabbing": @{ @"identifier": @"shown" } }]; [two addEntriesFromDictionary:@{ @"id": @"shown-2", @"tabbedWith": @"shown-1" }];
  Call(api, @"completeOpen", one); assert(!failure);
  Call(api, @"completeOpen", two); assert(!failure);
  for (NSWindow *window in @[first, second]) for (NSScreen *screen in NSScreen.screens) if (NSIntersectsRect(window.frame, screen.frame)) { fprintf(stderr, "%s on screen at %s\n", KeyFor(window).UTF8String, NSStringFromRect(window.frame).UTF8String); abort(); }
  assert(first.visible && second.visible && !NSApp.active);
  assert([GroupIds(first) isEqual:(@[@"shown-1", @"shown-2"])] && [SelectedId(first) isEqual:@"shown-2"] && [second.tabbingIdentifier isEqual:@"shown"]);
  for (NSString *key in @[@"shown-2", @"shown-1"]) { Call(api, @"close", @{ @"id": key }); assert(!failure); }
  Pump();
  puts("Shown window tabs passed");
}
// A simulated display as the driver takes it (docs/displays.md#simulated-displays), with a menu bar of `menuBar` points.
static NSDictionary *SimulatedDisplay(NSString *identifier, BOOL primary, double x, double y, double width, double height, double menuBar) {
  return @{ @"id": identifier, @"persistentId": NSNull.null, @"name": identifier, @"primary": @(primary), @"origin": @{ @"x": @(x), @"y": @(y) },
    @"size": @{ @"width": @(width), @"height": @(height) }, @"workArea": @{ @"x": @0, @"y": @(menuBar), @"width": @(width), @"height": @(height - menuBar) }, @"scaleFactor": @2,
    @"safeArea": @{ @"top": @(menuBar), @"left": @0, @"bottom": @0, @"right": @0 } };
}
static NSDictionary *DriverCommand(NSString *name, NSDictionary *request) {
  __block NSDictionary *answer = nil; driverCommands[name](request, ^(NSDictionary *value) { answer = value; }); Pump(); return answer;
}
// Display observation through the module: observe returns a snapshot with the current sequence, the driver's
// simulated source reaches listeners as displaysChanged, and unobserve stops native observation.
static void TestDisplays(RNDesktopWindows *api) {
  Call(api, @"observeDisplays", @{}); assert(!failure);
  NSDictionary *snapshot = SparkArgs(reply); double sequence = [snapshot[@"sequence"] doubleValue];
  assert([snapshot[@"displays"] count] == NSScreen.screens.count);
  NSArray *simulated = @[SimulatedDisplay(@"901", YES, 0, 0, 1512, 982, 32)];
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": simulated })[@"ok"] boolValue]);
  assert([simulatedState isEqual:@{ @"maximumFramesPerSecond": NSNull.null }]);  // no refresh rate given
  NSMutableDictionary *external = [SimulatedDisplay(@"902", NO, 1512, 0, 1920, 1080, 0) mutableCopy], *builtIn = [SimulatedDisplay(@"901", YES, 0, 0, 1512, 982, 32) mutableCopy];
  external[@"refreshRate"] = @{ @"maximum": @60 }; builtIn[@"refreshRate"] = @{ @"maximum": @120 };
  NSArray *promotion = @[external, builtIn];
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": promotion })[@"ok"] boolValue] && [simulatedState isEqual:@{ @"maximumFramesPerSecond": @120 }]);
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": simulated })[@"ok"] boolValue]);
  NSDictionary *event = events.lastObject;
  assert([event[@"type"] isEqual:@"displayDetailsChanged"] && [event[@"displays"] isEqual:simulated] && [event[@"sequence"] doubleValue] > sequence);
  Call(api, @"displayDetails", @{}); assert([SparkArgs(reply) isEqual:simulated]);
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null })[@"ok"] boolValue]);
  assert([events.lastObject[@"displays"] count] == NSScreen.screens.count && [simulatedState isEqual:@{ @"maximumFramesPerSecond": NSNull.null }]);
  NSDictionary *bare = @{ @"id": @"902", @"primary": @NO };
  NSArray *twoPrimaries = @[SimulatedDisplay(@"901", YES, 0, 0, 800, 600, 0), SimulatedDisplay(@"902", YES, 800, 0, 800, 600, 0)];
  for (id invalid in @[@[], @"901", @[@1], @[@{ @"id": @"901", @"primary": @YES }], @[simulated.firstObject, bare], twoPrimaries]) assert([DriverCommand(@"simulateDisplays", @{ @"displays": invalid })[@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  assert([DriverCommand(@"simulateDisplays", @{})[@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  Call(api, @"unobserveDisplays", @{}); assert(!failure);
  NSUInteger count = events.count;
  DriverCommand(@"simulateDisplays", @{ @"displays": simulated }); DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null });
  assert(events.count == count);
  puts("Display observation passed");
}
// Window sessions (restoreSession, duplicate) reopen a window at the bounds `info` reported, with explicit
// position and size. In driver mode too, the reopened window reports the same bounds and has the same frame,
// fractional points included, and explicit geometry wins over a saved restoreBounds record.
static void TestSessionFrames(RNDesktopWindows *api) {
  driverActive = YES;
  NSWindow *source = RealWindow(@"session-source");
  Call(api, @"completeOpen", @{ @"id": @"session-source", @"size": @{ @"width": @640, @"height": @480 } }); assert(!failure);
  NSRect visible = NSScreen.screens.firstObject.visibleFrame;
  [source setFrame:NSMakeRect(NSMinX(visible) + 137.5, NSMinY(visible) + 61.25, 701.5, 433) display:NO]; Pump();
  Call(api, @"info", @{ @"id": @"session-source" }); assert(!failure);
  NSDictionary *bounds = SparkArgs(reply)[@"bounds"];
  [NSUserDefaults.standardUserDefaults setObject:@{ @"version": @1, @"bounds": @{ @"displayId": bounds[@"displayId"], @"x": @0, @"y": @0, @"width": @300, @"height": @200 }, @"persistentId": @"" } forKey:SavedStateKey(@"session-copy")];
  NSWindow *copy = RealWindow(@"session-copy");
  Call(api, @"completeOpen", @{ @"id": @"session-copy", @"restoreBounds": @YES, @"position": @{ @"displayId": bounds[@"displayId"], @"x": bounds[@"x"], @"y": bounds[@"y"] }, @"size": @{ @"width": bounds[@"width"], @"height": bounds[@"height"] } }); assert(!failure);
  Call(api, @"info", @{ @"id": @"session-copy" }); assert(!failure);
  assert([SparkArgs(reply)[@"bounds"] isEqual:bounds]); assert(NSEqualRects(copy.frame, source.frame));
  assert(!OnScreen(source) && !OnScreen(copy));
  for (NSWindow *window in @[copy, source]) [window close];
  Pump(); driverActive = NO;
  [NSUserDefaults.standardUserDefaults removeObjectForKey:SavedStateKey(@"session-copy")];
  puts("Window session frames passed");
}
// Special window types (docs/api-window-contract.md#special-window-types): collection behaviors, and in driver mode
// window geometry on simulated displays and corner snapping. Windows are never on screen.
// Window pools: a pooled window parks on close (its instance ends as on close, the window stays hidden with a new
// instance), its React root takes new props, and discarding it closes and frees it.
static void TestWindowPools(RNDesktopWindows *api) {
  driverActive = YES;
  __weak NSWindow *weakWindow = nil;
  @autoreleasepool {
    NSWindow *window = RealWindow(@"pooled"); weakWindow = window;
    Call(api, @"completeOpen", @{ @"id": @"pooled", @"size": @{ @"width": @480, @"height": @320 } }); assert(!failure && ReportedVisible(api, @"pooled"));
    Call(api, @"rootProps", @{ @"id": @"pooled", @"props": @{ @"use": @1 } }); assert([failure isEqual:@"E_NOT_FOUND"]);
    RCTRootView *root = [RCTRootView new]; LegendWindowRegistry.sharedRegistry.rootViews[@"pooled"] = root;
    Call(api, @"rootProps", @{ @"id": @"pooled", @"props": @{ @"use": @1 } }); assert(!failure && [root.appProperties isEqual:@{ @"use": @1 }]);
    Call(api, @"observe", @{ @"id": @"pooled" }); NSString *first = SparkArgs(reply)[@"instanceId"];
    // Without the pool flag a close is a real close; with it, the guard still decides first.
    Call(api, @"pool", @{ @"id": @"pooled", @"enabled": @YES }); assert(!failure);
    Call(api, @"closeGuard", @{ @"id": @"pooled", @"instanceId": first, @"guardId": @"g", @"enabled": @YES }); assert(!failure);
    [events removeAllObjects];
    Call(api, @"close", @{ @"id": @"pooled" }); assert(!reply && [events.lastObject[@"type"] isEqual:@"beforeClose"]);
    Call(api, @"replyClose", @{ @"id": @"pooled", @"instanceId": first, @"guardId": @"g", @"requestId": events.lastObject[@"requestId"], @"allow": @YES });
    assert(windows[@"pooled"] == window && !ReportedVisible(api, @"pooled"));
    NSUInteger closed = [events indexOfObjectPassingTest:^BOOL(NSDictionary *event, NSUInteger, BOOL *) { return [event[@"type"] isEqual:@"closed"]; }];
    assert(closed != NSNotFound && [events[closed][@"instanceId"] isEqual:first]);
    Call(api, @"observe", @{ @"id": @"pooled" }); NSString *second = SparkArgs(reply)[@"instanceId"]; assert(second.length && ![second isEqual:first]);
    Call(api, @"info", @{ @"id": @"pooled", @"instanceId": first }); assert([failure isEqual:@"E_NOT_FOUND"]);
    // The guard ended with its instance: the close button parks again at once.
    Call(api, @"show", @{ @"id": @"pooled" }); assert(ReportedVisible(api, @"pooled"));
    [events removeAllObjects];
    assert(![window.delegate windowShouldClose:window] && windows[@"pooled"] == window && !ReportedVisible(api, @"pooled"));
    assert(events.count == 1 && [events[0][@"type"] isEqual:@"closed"] && [events[0][@"instanceId"] isEqual:second]);
    // Occlusion is reported only off the driver, where windows are on screen.
    [events removeAllObjects];
    [(id)window.delegate windowDidChangeOcclusionState:[NSNotification notificationWithName:NSWindowDidChangeOcclusionStateNotification object:window]]; assert(!events.count);
    driverActive = NO;
    [(id)window.delegate windowDidChangeOcclusionState:[NSNotification notificationWithName:NSWindowDidChangeOcclusionStateNotification object:window]];
    assert(events.count == 1 && [events[0][@"type"] isEqual:@"occlusionChanged"] && [events[0][@"occluded"] isEqual:@YES]);
    driverActive = YES;
    // Discarding closes for real: the registry lets go and the window is freed. Its use already ended, so no second closed.
    [events removeAllObjects];
    Call(api, @"discard", @{ @"id": @"pooled" }); assert(!failure && !windows[@"pooled"]);
    for (NSDictionary *event in events) assert(![event[@"type"] isEqual:@"closed"]);
    // A warm window emits no opened until it is reused; reusing one in use is refused.
    NSWindow *warm = RealWindow(@"warm"); (void)warm;
    [events removeAllObjects];
    Call(api, @"completeOpen", @{ @"id": @"warm", @"show": @NO, @"sparkWarm": @YES }); assert(!failure);
    for (NSDictionary *event in events) assert(![event[@"type"] isEqual:@"opened"]);
    LegendWindowRegistry.sharedRegistry.rootViews[@"warm"] = [RCTRootView new];
    Call(api, @"reuse", @{ @"id": @"warm", @"props": @{ @"use": @1 } }); assert(!failure && [events.lastObject[@"type"] isEqual:@"opened"]);
    Call(api, @"reuse", @{ @"id": @"warm", @"props": @{ @"use": @2 } }); assert([failure isEqual:@"E_BUSY"]);
    [events removeAllObjects];
    Call(api, @"discard", @{ @"id": @"warm" }); assert(!failure && [events.lastObject[@"type"] isEqual:@"closed"]);
    [LegendWindowRegistry.sharedRegistry.rootViews removeObjectForKey:@"warm"];
    [LegendWindowRegistry.sharedRegistry.rootViews removeObjectForKey:@"pooled"];
    Call(api, @"footprint", @{}); assert(!failure && [SparkArgs(reply)[@"bytes"] longLongValue] > 0);
    Pump();
  }
  Pump();
  assert(!weakWindow);
  driverActive = NO;
  printf("Window pools passed\n");
}
static void TestSpecialWindows(RNDesktopWindows *api) {
  driverActive = YES;
  NSPanel *panel = (NSPanel *)RealWindow(@"special-panel", NSPanel.class);
  panel.styleMask |= NSWindowStyleMaskNonactivatingPanel;
  Call(api, @"completeOpen", @{ @"id": @"special-panel", @"size": @{ @"width": @400, @"height": @300 }, @"macos": @{ @"spaces": @"all", @"fullScreenAuxiliary": @YES, @"stationary": @YES, @"ignoresCycle": @YES } }); assert(!failure);
  NSWindowCollectionBehavior behavior = panel.collectionBehavior;
  assert(behavior & NSWindowCollectionBehaviorCanJoinAllSpaces); assert(behavior & NSWindowCollectionBehaviorFullScreenAuxiliary); assert(!(behavior & NSWindowCollectionBehaviorFullScreenPrimary));
  assert(behavior & NSWindowCollectionBehaviorStationary); assert(behavior & NSWindowCollectionBehaviorIgnoresCycle); assert(!OnScreen(panel));
  Call(api, @"options", @{ @"id": @"special-panel", @"options": @{ @"macos": @{ @"fullScreenAuxiliary": @NO, @"stationary": @NO, @"ignoresCycle": @NO } } }); assert(!failure);
  behavior = panel.collectionBehavior;
  assert(!(behavior & (NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle))); assert(behavior & NSWindowCollectionBehaviorCanJoinAllSpaces);

  // Simulated displays: 901 (primary, 32-point menu bar) and 902 to its right, 100 points lower.
  NSArray *displays = @[SimulatedDisplay(@"901", YES, 0, 0, 1512, 982, 32), SimulatedDisplay(@"902", NO, 1512, 100, 1920, 1080, 0)];
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": displays })[@"ok"] boolValue]);
  Call(api, @"displays", @{}); assert(!failure);
  NSArray *info = (NSArray *)SparkArgs(reply);
  assert(info.count == 2 && [info[1][@"id"] isEqual:@"902"] && ![info[1][@"primary"] boolValue] && [info[0][@"workArea"][@"y"] isEqual:@32] && [info[1][@"size"][@"width"] isEqual:@1920]);
  NSWindow *audience = RealWindow(@"special-audience");
  Call(api, @"completeOpen", @{ @"id": @"special-audience", @"position": @{ @"displayId": @"902", @"x": @0, @"y": @0 }, @"size": @{ @"width": @1920, @"height": @1080 } }); assert(!failure);
  // AppKit global frame: x from the origin, Y upward from the primary display's bottom (982 - 100 - 1080).
  assert(NSEqualRects(audience.frame, NSMakeRect(1512, -198, 1920, 1080)));
  Call(api, @"info", @{ @"id": @"special-audience" }); assert([SparkArgs(reply)[@"bounds"] isEqual:(@{ @"displayId": @"902", @"x": @0, @"y": @0, @"width": @1920, @"height": @1080 })]);
  NSWindow *controller = RealWindow(@"special-controller");
  Call(api, @"completeOpen", @{ @"id": @"special-controller", @"size": @{ @"width": @1000, @"height": @700 } }); assert(!failure);
  Call(api, @"info", @{ @"id": @"special-controller" }); assert([SparkArgs(reply)[@"bounds"] isEqual:(@{ @"displayId": @"901", @"x": @256, @"y": @157, @"width": @1000, @"height": @700 })]);
  Call(api, @"center", @{ @"id": @"special-controller", @"displayId": @"902" }); assert(!failure);
  Call(api, @"info", @{ @"id": @"special-controller" }); assert([SparkArgs(reply)[@"bounds"] isEqual:(@{ @"displayId": @"902", @"x": @460, @"y": @190, @"width": @1000, @"height": @700 })]);
  // An animated move animates windows that are not on screen too (driven windows never are), and resolves when it ends.
  Call(api, @"bounds", @{ @"id": @"special-controller", @"durationMs": @200, @"bounds": @{ @"displayId": @"902", @"x": @10, @"y": @20, @"width": @1000, @"height": @700 } });
  assert(!failure && !reply);
  for (int i = 0; i < 50 && !reply; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  assert(!failure && [reply isEqual:@"null"]); assert([SparkWindowBounds(controller) isEqual:(@{ @"displayId": @"902", @"x": @10, @"y": @20, @"width": @1000, @"height": @700 })]);
  Call(api, @"bounds", @{ @"id": @"special-controller", @"bounds": @{ @"displayId": @"903", @"x": @0, @"y": @0, @"width": @400, @"height": @300 } }); assert([failure isEqual:@"E_NOT_FOUND"]);

  // Corner snapping: a move ends at the nearest corner of the work area, inset by the margin.
  Call(api, @"options", @{ @"id": @"special-controller", @"options": @{ @"macos": @{ @"cornerSnapping": @{ @"margin": @16 } } } }); assert(!failure);
  Call(api, @"bounds", @{ @"id": @"special-controller", @"bounds": @{ @"displayId": @"901", @"x": @100, @"y": @80, @"width": @400, @"height": @300 } }); assert(!failure);
  for (int i = 0; i < 50 && (Animating(controller) || ![SparkWindowBounds(controller)[@"x"] isEqual:@16]); ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  assert([SparkWindowBounds(controller) isEqual:(@{ @"displayId": @"901", @"x": @16, @"y": @48, @"width": @400, @"height": @300 })]);
  Call(api, @"bounds", @{ @"id": @"special-controller", @"bounds": @{ @"displayId": @"902", @"x": @1500, @"y": @700, @"width": @400, @"height": @300 } }); assert(!failure);
  for (int i = 0; i < 50 && (Animating(controller) || ![SparkWindowBounds(controller)[@"x"] isEqual:@1504]); ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  assert([SparkWindowBounds(controller) isEqual:(@{ @"displayId": @"902", @"x": @1504, @"y": @764, @"width": @400, @"height": @300 })]);
  Call(api, @"options", @{ @"id": @"special-controller", @"options": @{ @"macos": @{ @"cornerSnapping": NSNull.null } } }); assert(!failure);
  Call(api, @"bounds", @{ @"id": @"special-controller", @"bounds": @{ @"displayId": @"902", @"x": @700, @"y": @300, @"width": @400, @"height": @300 } }); assert(!failure);
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.3]];
  assert([SparkWindowBounds(controller) isEqual:(@{ @"displayId": @"902", @"x": @700, @"y": @300, @"width": @400, @"height": @300 })]);

  assert([DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null })[@"ok"] boolValue]);
  Call(api, @"displays", @{}); assert([SparkArgs(reply) count] == NSScreen.screens.count);
  assert(!OnScreen(panel) && !OnScreen(audience) && !OnScreen(controller));
  for (NSWindow *window in @[panel, audience, controller]) [window close];
  Pump(); driverActive = NO;
  puts("Special windows passed");
}
// Window choreography on the virtual clock: zooms, frame animations, interruption, close transitions and focus handoff,
// Reduce Motion, and attached windows. Driver mode: nothing is shown.
static NSDictionary *Bounds(NSWindow *window) { return SparkWindowBounds(window); }
static BOOL Near(NSDictionary *bounds, double x, double y, double width, double height) {
  return fabs([bounds[@"x"] doubleValue] - x) < 0.01 && fabs([bounds[@"y"] doubleValue] - y) < 0.01 && fabs([bounds[@"width"] doubleValue] - width) < 0.01 && fabs([bounds[@"height"] doubleValue] - height) < 0.01;
}
static BOOL Result(NSString *json, BOOL finished, BOOL reduced) { return json && [SparkArgs(json) isEqual:(@{ @"finished": @(finished), @"reducedMotion": @(reduced) })]; }
static NSArray<NSDictionary *> *AttachmentEvents(void) { return [events filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"type == 'attachmentChanged'"]]; }
static void Begin(RNDesktopWindows *api, NSString *method, NSDictionary *args, NSString *__strong *result) {
  *result = nil; failure = nil;
  [api call:method args:SparkJSON(args) resolve:^(id value) { *result = value; } reject:^(NSString *code, NSString *, NSError *) { failure = code; }]; Pump();
}
static void TestChoreography(RNDesktopWindows *api) {
  driverActive = YES;
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": @[SimulatedDisplay(@"901", YES, 0, 0, 1512, 982, 32)] })[@"ok"] boolValue]);
  DriverClock(YES, 0);
  __weak NSWindow *weakWindow = nil;
  @autoreleasepool {
    NSWindow *window = RealWindow(@"choreo"); weakWindow = window;
    Call(api, @"completeOpen", @{ @"id": @"choreo", @"size": @{ @"width": @400, @"height": @300 }, @"position": @{ @"displayId": @"901", @"x": @100, @"y": @100 }, @"show": @NO }); assert(!failure);
    // Zoom: shown at once at the source, transparent; halfway (linear) at 100 ms; at its frame, opaque, at 200 ms.
    NSString *zoom = nil;
    Begin(api, @"zoomIn", @{ @"id": @"choreo", @"from": @{ @"displayId": @"901", @"x": @0, @"y": @50, @"width": @40, @"height": @30 }, @"durationMs": @200, @"easing": @"linear" }, &zoom);
    assert(!failure && !zoom && ReportedVisible(api, @"choreo") && window.alphaValue == 0 && Near(Bounds(window), 0, 50, 40, 30));
    DriverClock(YES, 100); assert(!zoom && Near(Bounds(window), 50, 75, 220, 165) && fabs(window.alphaValue - 0.5) < 0.01);
    DriverClock(YES, 100); assert(Result(zoom, YES, NO) && Near(Bounds(window), 100, 100, 400, 300) && window.alphaValue == 1);
    // A second animation interrupts the first where it is; stopAnimation leaves the window where it is.
    NSString *first = nil, *second = nil;
    Begin(api, @"animate", @{ @"id": @"choreo", @"bounds": @{ @"displayId": @"901", @"x": @300, @"y": @100, @"width": @400, @"height": @300 }, @"durationMs": @200, @"easing": @"linear" }, &first);
    DriverClock(YES, 50); assert(!first && Near(Bounds(window), 150, 100, 400, 300));
    Begin(api, @"animate", @{ @"id": @"choreo", @"bounds": @{ @"displayId": @"901", @"x": @150, @"y": @200, @"width": @400, @"height": @300 }, @"durationMs": @100, @"easing": @"easeInOut" }, &second);
    assert(Result(first, NO, NO) && !second);
    DriverClock(YES, 50); assert(Near(Bounds(window), 150, 150, 400, 300));
    Call(api, @"stopAnimation", @{ @"id": @"choreo" }); assert(!failure && Result(second, NO, NO) && Near(Bounds(window), 150, 150, 400, 300));
    Call(api, @"animate", @{ @"id": @"choreo", @"bounds": @{ @"displayId": @"901", @"x": @0, @"y": @0, @"width": @50, @"height": @50 }, @"durationMs": @100 }); assert([failure isEqual:@"E_INVALID_ARGUMENT"]);
    // Close transition into a rectangle of another window: the shrink hands focus to that window; another animation
    // interrupts the shrink and cancels the close; the next close shrinks all the way and closes.
    NSWindow *home = RealWindow(@"choreo-home");
    Call(api, @"completeOpen", @{ @"id": @"choreo-home", @"size": @{ @"width": @600, @"height": @400 }, @"position": @{ @"displayId": @"901", @"x": @700, @"y": @300 } }); assert(!failure);
    NSDictionary *transition = @{ @"to": @{ @"windowId": @"choreo-home", @"x": @10, @"y": @20, @"width": @100, @"height": @50 }, @"durationMs": @100, @"easing": @"linear" };
    assert(HandoffTarget(window, transition) == home && !HandoffTarget(window, @{}) && HandoffTarget(home, @{ @"focus": @"choreo" }) == window);
    Call(api, @"closeTransition", @{ @"id": @"choreo", @"transition": transition }); assert(!failure);
    NSString *closed = nil;
    Begin(api, @"close", @{ @"id": @"choreo" }, &closed); assert(!closed && windows[@"choreo"] == window);
    DriverClock(YES, 50); assert(fabs(window.alphaValue - 0.5) < 0.01 && !closed);
    Begin(api, @"animate", @{ @"id": @"choreo", @"bounds": @{ @"displayId": @"901", @"x": @100, @"y": @100, @"width": @400, @"height": @300 }, @"durationMs": @100, @"easing": @"linear" }, &first);
    assert([closed isEqual:@"{\"closed\":false,\"reason\":\"interrupted\"}"] && windows[@"choreo"] == window);
    DriverClock(YES, 100); assert(Result(first, YES, NO) && window.alphaValue == 1 && Near(Bounds(window), 100, 100, 400, 300));
    Begin(api, @"close", @{ @"id": @"choreo" }, &closed);
    DriverClock(YES, 100); Pump();
    assert([closed isEqual:@"{\"closed\":true}"] && !windows[@"choreo"]);
    // Reduce Motion: a zoom is a fade at the window's frame, and a move is immediate.
    SparkTestDriverDidSimulateState(@{ @"reduceMotion": @YES });
    NSWindow *calm = RealWindow(@"choreo-calm");
    Call(api, @"completeOpen", @{ @"id": @"choreo-calm", @"size": @{ @"width": @400, @"height": @300 }, @"position": @{ @"displayId": @"901", @"x": @100, @"y": @100 }, @"show": @NO }); assert(!failure);
    Begin(api, @"zoomIn", @{ @"id": @"choreo-calm", @"from": @{ @"displayId": @"901", @"x": @0, @"y": @50, @"width": @40, @"height": @30 }, @"durationMs": @200, @"easing": @"linear" }, &zoom);
    assert(!zoom && Near(Bounds(calm), 100, 100, 400, 300) && calm.alphaValue == 0);
    DriverClock(YES, 100); assert(fabs(calm.alphaValue - 0.5) < 0.01);
    DriverClock(YES, 100); assert(Result(zoom, YES, YES));
    Call(api, @"animate", @{ @"id": @"choreo-calm", @"bounds": @{ @"displayId": @"901", @"x": @200, @"y": @100, @"width": @400, @"height": @300 }, @"durationMs": @200 });
    assert(Result(reply, YES, YES) && Near(Bounds(calm), 200, 100, 400, 300));
    SparkTestDriverDidSimulateState(@{ @"reduceMotion": NSNull.null });
    [calm close];
    // Attached window: docked at the parent's trailing edge, top-aligned, 8 points out; it follows the parent's moves and
    // resizes; a move within the magnetic distance docks it again, a farther one undocks it, and back near docks it.
    NSWindow *inspector = RealWindow(@"choreo-inspector");
    Call(api, @"completeOpen", @{ @"id": @"choreo-inspector", @"size": @{ @"width": @240, @"height": @300 }, @"position": @{ @"displayId": @"901", @"x": @0, @"y": @500 } }); assert(!failure);
    Call(api, @"attach", @{ @"id": @"choreo-inspector", @"parentId": @"choreo-home", @"token": @"t1", @"edge": @"trailing", @"gap": @8, @"magnetic": @24, @"hideWhenInactive": @YES, @"durationMs": @100, @"easing": @"linear" });
    assert(!reply); DriverClock(YES, 100);
    assert(Result(reply, YES, NO) && inspector.parentWindow == home && inspector.hidesOnDeactivate && Near(Bounds(inspector), 1308, 300, 240, 300));
    Call(api, @"attachment", @{ @"id": @"choreo-inspector" }); assert([reply isEqual:@"{\"attached\":true,\"hidesWhenInactive\":true}"]);
    Call(api, @"bounds", @{ @"id": @"choreo-home", @"bounds": @{ @"displayId": @"901", @"x": @600, @"y": @250, @"width": @500, @"height": @400 } }); assert(!failure);
    assert(Near(Bounds(inspector), 1108, 250, 240, 300));
    [events removeAllObjects];
    Call(api, @"bounds", @{ @"id": @"choreo-inspector", @"bounds": @{ @"displayId": @"901", @"x": @1120, @"y": @260, @"width": @240, @"height": @300 } }); assert(!failure);
    DriverClock(YES, 150); assert(Near(Bounds(inspector), 1108, 250, 240, 300) && inspector.parentWindow == home && !AttachmentEvents().count);
    Call(api, @"bounds", @{ @"id": @"choreo-inspector", @"bounds": @{ @"displayId": @"901", @"x": @1200, @"y": @250, @"width": @240, @"height": @300 } }); assert(!failure);
    assert(!inspector.parentWindow && AttachmentEvents().count == 1 && [AttachmentEvents()[0][@"attached"] isEqual:@NO]);
    Call(api, @"bounds", @{ @"id": @"choreo-home", @"bounds": @{ @"displayId": @"901", @"x": @500, @"y": @250, @"width": @500, @"height": @400 } });
    assert(Near(Bounds(inspector), 1200, 250, 240, 300));
    Call(api, @"bounds", @{ @"id": @"choreo-inspector", @"bounds": @{ @"displayId": @"901", @"x": @1010, @"y": @240, @"width": @240, @"height": @300 } });
    assert(inspector.parentWindow == home && AttachmentEvents().count == 2 && [AttachmentEvents()[1][@"attached"] isEqual:@YES]);
    DriverClock(YES, 150); assert(Near(Bounds(inspector), 1008, 250, 240, 300));
    Call(api, @"detach", @{ @"id": @"choreo-inspector", @"token": @"stale" }); assert(inspector.parentWindow == home);
    Call(api, @"detach", @{ @"id": @"choreo-inspector", @"token": @"t1" }); assert(!inspector.parentWindow && !inspector.hidesOnDeactivate);
    Call(api, @"attachment", @{ @"id": @"choreo-inspector" }); assert([reply isEqual:@"null"]);
    // The parent closing ends the attachment.
    Call(api, @"attach", @{ @"id": @"choreo-inspector", @"parentId": @"choreo-home", @"token": @"t2", @"edge": @"bottom", @"align": @"center", @"magnetic": @0 }); assert(!failure);
    assert(Near(Bounds(inspector), 630, 650, 240, 300));
    Call(api, @"attach", @{ @"id": @"choreo-inspector", @"parentId": @"choreo-inspector", @"edge": @"left" }); assert([failure isEqual:@"E_INVALID_ARGUMENT"]);
    [events removeAllObjects];
    Call(api, @"close", @{ @"id": @"choreo-home" }); assert(!windows[@"choreo-home"] && !inspector.parentWindow);
    assert(AttachmentEvents().count == 1 && [AttachmentEvents()[0][@"windowId"] isEqual:@"choreo-inspector"] && [AttachmentEvents()[0][@"token"] isEqual:@"t2"] && [AttachmentEvents()[0][@"attached"] isEqual:@NO]);
    assert(!OnScreen(inspector) && !OnScreen(home));
    [inspector close];
    // A close transition with `to: null` (no focus) fades the window out where it is, then closes it.
    NSWindow *fading = RealWindow(@"choreo-fade");
    Call(api, @"completeOpen", @{ @"id": @"choreo-fade", @"size": @{ @"width": @400, @"height": @300 }, @"position": @{ @"displayId": @"901", @"x": @100, @"y": @100 } }); assert(!failure);
    NSDictionary *fade = @{ @"to": NSNull.null, @"durationMs": @100, @"easing": @"linear" };
    assert(!HandoffTarget(fading, fade));
    Call(api, @"closeTransition", @{ @"id": @"choreo-fade", @"transition": fade }); assert(!failure);
    Begin(api, @"close", @{ @"id": @"choreo-fade" }, &closed);
    DriverClock(YES, 50); assert(!closed && fabs(fading.alphaValue - 0.5) < 0.01 && Near(Bounds(fading), 100, 100, 400, 300));
    DriverClock(YES, 50); Pump(); assert([closed isEqual:@"{\"closed\":true}"] && !windows[@"choreo-fade"]);
    // An animated setWindowBounds interrupted by another settles nothing (no corner snap) and leaves one animation running;
    // the snap starts once the second move ends.
    NSWindow *snapping = RealWindow(@"choreo-snap");
    Call(api, @"completeOpen", @{ @"id": @"choreo-snap", @"size": @{ @"width": @400, @"height": @300 }, @"position": @{ @"displayId": @"901", @"x": @600, @"y": @300 }, @"macos": @{ @"cornerSnapping": @{ @"margin": @16 } } }); assert(!failure);
    NSString *move = nil;
    Begin(api, @"bounds", @{ @"id": @"choreo-snap", @"durationMs": @200, @"bounds": @{ @"displayId": @"901", @"x": @300, @"y": @200, @"width": @400, @"height": @300 } }, &first);
    DriverClock(YES, 50); assert(!first);
    Begin(api, @"bounds", @{ @"id": @"choreo-snap", @"durationMs": @200, @"bounds": @{ @"displayId": @"901", @"x": @400, @"y": @250, @"width": @400, @"height": @300 } }, &move);
    assert([first isEqual:@"null"] && !move && Animations.count == 1);
    DriverClock(YES, 200); assert([move isEqual:@"null"] && Near(Bounds(snapping), 400, 250, 400, 300) && Animations.count == 1);
    DriverClock(YES, 200); assert(Near(Bounds(snapping), 16, 48, 400, 300) && !Animations.count);
    [snapping close];
    // Attaching a window opened with a parent elsewhere, then detaching it (or its new parent closing), gives it back its parent.
    NSWindow *owner = RealWindow(@"choreo-owner"), *other = RealWindow(@"choreo-other"), *child = RealWindow(@"choreo-child");
    for (NSString *key in @[@"choreo-owner", @"choreo-other"]) { Call(api, @"completeOpen", @{ @"id": key, @"size": @{ @"width": @400, @"height": @300 } }); assert(!failure); }
    Call(api, @"completeOpen", @{ @"id": @"choreo-child", @"parentId": @"choreo-owner", @"size": @{ @"width": @200, @"height": @200 } }); assert(!failure && child.parentWindow == owner);
    Call(api, @"attach", @{ @"id": @"choreo-child", @"parentId": @"choreo-other", @"token": @"t3", @"edge": @"left", @"magnetic": @0 }); assert(!failure && child.parentWindow == other);
    Call(api, @"attach", @{ @"id": @"choreo-child", @"parentId": @"choreo-other", @"token": @"t4", @"edge": @"right", @"magnetic": @0 }); assert(!failure && child.parentWindow == other);
    Call(api, @"detach", @{ @"id": @"choreo-child", @"token": @"t4" }); assert(child.parentWindow == owner);
    Call(api, @"attach", @{ @"id": @"choreo-child", @"parentId": @"choreo-other", @"token": @"t5", @"edge": @"top", @"magnetic": @0 }); assert(!failure && child.parentWindow == other);
    Call(api, @"close", @{ @"id": @"choreo-other" }); assert(!windows[@"choreo-other"] && child.parentWindow == owner);
    for (NSWindow *window in @[child, owner]) [window close];
    Pump();
  }
  Pump();
  assert(!weakWindow && !Animations.count && !AnimationTimer);
  DriverClock(NO, 0);
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null })[@"ok"] boolValue]);
  driverActive = NO;
  puts("Window choreography passed");
}
static void TestGuards(RNDesktopWindows *api) {
  TestWindow *window = [TestWindow new]; windows[@"editor"] = (NSWindow *)window;
  __block NSString *result = nil;
  auto call = ^(NSString *method, NSDictionary *args) {
    [api call:method args:SparkJSON(args) resolve:^(id value) { result = value; } reject:^(NSString *code, NSString *, NSError *) { failure = code; }]; Pump();
  };
  call(@"closeGuard", @{ @"id": @"editor", @"enabled": @YES, @"guardId": @"guard" }); assert(!failure);
  NSString *instance = delegates[@"editor"].instanceId;
  result = nil; call(@"close", @{ @"id": @"editor" }); assert(!result && !window.closed);
  NSDictionary *request = events.lastObject; assert([request[@"type"] isEqual:@"beforeClose"]); assert([request[@"instanceId"] isEqual:instance]);
  call(@"replyClose", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"requestId": request[@"requestId"], @"allow": @NO });
  assert(!window.closed); assert(delegates[@"editor"].closeWaiters.count == 0);
  __block NSString *closedResult = nil;
  [api call:@"close" args:SparkJSON(@{ @"id": @"editor" }) resolve:^(id value) { closedResult = value; } reject:^(NSString *, NSString *, NSError *) { assert(false); }]; Pump();
  request = events.lastObject;
  call(@"replyClose", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"requestId": request[@"requestId"], @"allow": @YES });
  assert(window.closed); assert([closedResult isEqual:@"{\"closed\":true}"]); assert(!windows[@"editor"]);
  TestWindow *replacement = [TestWindow new]; windows[@"editor"] = (NSWindow *)replacement;
  failure = nil; call(@"closeGuard", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"enabled": @NO });
  assert([failure isEqual:@"E_NOT_FOUND"]); assert(![delegates[@"editor"].instanceId isEqual:instance]);
  [windows removeObjectForKey:@"editor"];
  puts("Window guards passed");
}
// Usage: test [suite] [-NSDefault value ...]. With a suite name, runs only that suite (the right-to-left
// run needs only the direction-dependent options suite). Unbuffered, so a timeout shows the last suite reached.
int main(int argc, char **argv) { @autoreleasepool {
  setvbuf(stdout, NULL, _IONBF, 0);
  [NSApplication sharedApplication];
  events = [NSMutableArray new]; windows = LegendWindowRegistry.sharedRegistry.windows;
  RNDesktopWindows *api = [RNDesktopWindows new];
  NSDictionary<NSString *, void (^)(RNDesktopWindows *)> *suites = @{
    @"guards": ^(RNDesktopWindows *a) { TestGuards(a); }, @"options": ^(RNDesktopWindows *a) { TestWindowOptions(a); },
    @"driver": ^(RNDesktopWindows *a) { TestDriverMode(a); }, @"tabs": ^(RNDesktopWindows *a) { TestWindowTabs(a); },
    @"shown-tabs": ^(RNDesktopWindows *a) { TestShownTabs(a); }, @"tab-restoration": ^(RNDesktopWindows *a) { TestTabRestoration(a); },
    @"displays": ^(RNDesktopWindows *a) { TestDisplays(a); }, @"session-frames": ^(RNDesktopWindows *a) { TestSessionFrames(a); },
    @"special": ^(RNDesktopWindows *a) { TestSpecialWindows(a); }, @"pools": ^(RNDesktopWindows *a) { TestWindowPools(a); },
    @"choreography": ^(RNDesktopWindows *a) { TestChoreography(a); },
  };
  NSString *only = argc > 1 && argv[1][0] != '-' ? @(argv[1]) : nil;
  if (only && !suites[only]) { fprintf(stderr, "Unknown suite %s\n", argv[1]); return 2; }
  for (NSString *name in @[@"guards", @"options", @"driver", @"tabs", @"shown-tabs", @"tab-restoration", @"displays", @"session-frames", @"special", @"pools", @"choreography"]) if (!only || [only isEqual:name]) suites[name](api);
} }
