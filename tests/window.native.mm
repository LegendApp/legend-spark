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
static NSWindow *RealWindow(NSString *key) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 200, 640, 480) styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
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
int main() { @autoreleasepool {
  events = [NSMutableArray new]; windows = LegendWindowRegistry.sharedRegistry.windows;
  TestWindow *window = [TestWindow new]; windows[@"editor"] = (NSWindow *)window;
  RNDesktopWindows *api = [RNDesktopWindows new];
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
  puts("Window guards passed");
  TestWindowOptions(api);
  TestDriverMode(api);
} }
