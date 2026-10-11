#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cassert>
#include <memory>
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
static NSDictionary *DriverCommand(NSString *name, NSDictionary *request) {
  __block NSDictionary *answer = nil; driverCommands[name](request, ^(NSDictionary *value) { answer = value; }); Pump(); return answer;
}
// Display observation through the module: observe returns a snapshot with the current sequence, the driver's
// simulated source reaches listeners as displaysChanged, and unobserve stops native observation.
static void TestDisplays(RNDesktopWindows *api) {
  Call(api, @"observeDisplays", @{}); assert(!failure);
  NSDictionary *snapshot = SparkArgs(reply); double sequence = [snapshot[@"sequence"] doubleValue];
  assert([snapshot[@"displays"] count] == NSScreen.screens.count);
  NSArray *simulated = @[@{ @"id": @"901", @"primary": @YES }];
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": simulated })[@"ok"] boolValue]);
  NSDictionary *event = events.lastObject;
  assert([event[@"type"] isEqual:@"displaysChanged"] && [event[@"displays"] isEqual:simulated] && [event[@"sequence"] doubleValue] > sequence);
  Call(api, @"displayDetails", @{}); assert([SparkArgs(reply) isEqual:simulated]);
  assert([DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null })[@"ok"] boolValue]);
  assert([events.lastObject[@"displays"] count] == NSScreen.screens.count);
  for (id invalid in @[@[], @"901", @[@1]]) assert([DriverCommand(@"simulateDisplays", @{ @"displays": invalid })[@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  assert([DriverCommand(@"simulateDisplays", @{})[@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  Call(api, @"unobserveDisplays", @{}); assert(!failure);
  NSUInteger count = events.count;
  DriverCommand(@"simulateDisplays", @{ @"displays": simulated }); DriverCommand(@"simulateDisplays", @{ @"displays": NSNull.null });
  assert(events.count == count);
  puts("Display observation passed");
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
    @"displays": ^(RNDesktopWindows *a) { TestDisplays(a); },
  };
  NSString *only = argc > 1 && argv[1][0] != '-' ? @(argv[1]) : nil;
  if (only && !suites[only]) { fprintf(stderr, "Unknown suite %s\n", argv[1]); return 2; }
  for (NSString *name in @[@"guards", @"options", @"driver", @"tabs", @"shown-tabs", @"tab-restoration", @"displays"]) if (!only || [only isEqual:name]) suites[name](api);
} }
