#import "RNDesktopWindows.h"
#import "window-manager/LegendWindowRegistry.h"
#import "SparkWindowGeometry.h"
#import <objc/runtime.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#import <React/RCTSurfaceHostingView.h>

static void Show(NSWindow *window) {
  if ([window isKindOfClass:NSPanel.class] && (window.styleMask & NSWindowStyleMaskNonactivatingPanel)) [window orderFrontRegardless];
  else [window makeKeyAndOrderFront:nil];
}
@interface SparkWindowDelegate : NSObject <NSWindowDelegate>
@property NSString *windowID;
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic, weak) id<NSWindowDelegate> previousDelegate;
@property BOOL guarded;
@property BOOL allowingClose;
@property NSUInteger request;
@property BOOL pending;
@property NSString *instanceId;
@property NSString *guardId;
@property NSMutableArray *closeWaiters;
@property NSMutableArray *fullscreenWaiters;
@property NSNumber *fullscreenTarget;
@property BOOL restoreBounds;
- (void)finishClose:(BOOL)closed;
- (void)finishFullscreen:(BOOL)success;

- (void)requestClose;
@end
static NSMutableDictionary<NSString *, NSWindow *> *windows;
static NSMutableDictionary<NSString *, SparkWindowDelegate *> *delegates;
static NSWindow *Window(NSString *key) {
  if (!windows) windows = LegendWindowRegistry.sharedRegistry.windows;
  NSWindow *window = windows[key];
  if (!window && [key isEqual:@"main"]) {
    for (NSWindow *candidate in NSApp.windows) {
      if ([candidate.identifier isEqual:@"spark.main"]) { window = candidate; break; }
    }
    if (window) windows[key] = window;
  }
  return window;
}
static void Event(NSString *type, NSString *key) {
  NSWindow *window = Window(key);
  NSMutableDictionary *event = [@{ @"type": type, @"windowId": key, @"instanceId": delegates[key].instanceId ?: @"" } mutableCopy];
  if ([type isEqual:@"move"] || [type isEqual:@"resize"] || [type isEqual:@"screenChanged"]) {
    event[@"type"] = @"boundsChanged"; event[@"bounds"] = SparkBoundsForWindow(window);
    if (delegates[key].restoreBounds && !window.miniaturized && !(window.styleMask & NSWindowStyleMaskFullScreen)) {
      NSScreen *screen = SparkOwningScreen(window.frame);
      [NSUserDefaults.standardUserDefaults setObject:@{ @"version": @1, @"bounds": event[@"bounds"], @"persistentId": SparkPersistentScreenId(screen) ?: @"" }
        forKey:[NSString stringWithFormat:@"%@.bounds.%@", SparkNamespace(), key]];
    }
  } else if ([type isEqual:@"focus"] || [type isEqual:@"blur"]) { event[@"type"] = @"focusChanged"; event[@"focused"] = @([type isEqual:@"focus"]); }
  else if ([type isEqual:@"enterFullscreen"] || [type isEqual:@"leaveFullscreen"]) { event[@"type"] = @"fullscreenChanged"; event[@"fullscreen"] = @([type isEqual:@"enterFullscreen"]); }
  else if ([type isEqual:@"visibilityChanged"]) event[@"visible"] = @(window.visible && !NSApp.hidden);
  SparkEmit(event);
}
@implementation SparkWindowDelegate
- (void)finishClose:(BOOL)closed {
  NSArray *waiters = [self.closeWaiters copy]; [self.closeWaiters removeAllObjects];
  for (RCTPromiseResolveBlock waiter in waiters) waiter(closed ? @"{\"closed\":true}" : @"{\"closed\":false,\"reason\":\"vetoed\"}");
}
- (void)finishFullscreen:(BOOL)success {
  NSArray *waiters = [self.fullscreenWaiters copy]; [self.fullscreenWaiters removeAllObjects]; self.fullscreenTarget = nil;
  for (NSDictionary *waiter in waiters) {
    if (success) ((RCTPromiseResolveBlock)waiter[@"resolve"])(@"null");
    else ((RCTPromiseRejectBlock)waiter[@"reject"])(@"E_NATIVE", @"Fullscreen transition failed", nil);
  }
}

- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || [self.previousDelegate respondsToSelector:selector]; }
- (id)forwardingTargetForSelector:(SEL)selector { return [self.previousDelegate respondsToSelector:selector] ? self.previousDelegate : [super forwardingTargetForSelector:selector]; }
- (void)requestClose {
  if (self.pending) return;
  self.pending = YES; NSUInteger request = ++self.request;
  SparkEmit(@{ @"type": @"beforeClose", @"windowId": self.windowID, @"instanceId": self.instanceId, @"guardId": self.guardId ?: @"", @"requestId": @(request) });
  __weak SparkWindowDelegate *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    SparkWindowDelegate *delegate = weakSelf;
    if (delegate.pending && delegate.request == request) { delegate.pending = NO; [delegate finishClose:NO]; SparkEmit(@{ @"type": @"closeGuardTimeout", @"windowId": delegate.windowID, @"instanceId": delegate.instanceId, @"guardId": delegate.guardId ?: @"" }); }
  });
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
  if (self.guarded && !self.allowingClose) { [self requestClose]; return NO; }
  return [self.previousDelegate respondsToSelector:@selector(windowShouldClose:)] ? [self.previousDelegate windowShouldClose:sender] : YES;
}
- (void)windowWillClose:(NSNotification *)note {
  [self finishClose:YES]; [self finishFullscreen:NO];
  BOOL managed = LegendWindowRegistry.sharedRegistry.moduleNames[self.windowID] != nil;
  if ([self.previousDelegate respondsToSelector:@selector(windowWillClose:)]) [self.previousDelegate windowWillClose:note];
  NSWindow *closing = note.object;
  if (closing.sheetParent) [closing.sheetParent endSheet:closing];
  if (closing.parentWindow) [closing.parentWindow removeChildWindow:closing];
  Event(@"closed", self.windowID);
  if (![self.windowID isEqual:@"main"] && !managed) {
    NSWindow *window = note.object;
    NSView *root = [window.contentView isKindOfClass:NSVisualEffectView.class] ? window.contentView.subviews.firstObject : window.contentView;
    if ([root isKindOfClass:RCTSurfaceHostingView.class]) [((RCTSurfaceHostingView *)root).surface stop];
    [root removeFromSuperview];
    window.contentView = [[NSView alloc] initWithFrame:root.frame];
    [windows removeObjectForKey:self.windowID];
    [LegendWindowRegistry.sharedRegistry.rootViews removeObjectForKey:self.windowID];
  }
  [windows removeObjectForKey:self.windowID];
  {
    // Retain the proxy until its delegate callback returns.
    dispatch_async(dispatch_get_main_queue(), ^{
      if (delegates[self.windowID] == self) [delegates removeObjectForKey:self.windowID];
    });
  }
}
- (void)windowDidMove:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidMove:)]) [self.previousDelegate windowDidMove:note]; Event(@"move", self.windowID); }
- (void)windowDidResize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidResize:)]) [self.previousDelegate windowDidResize:note]; Event(@"resize", self.windowID); }
- (void)windowDidChangeScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidChangeScreen:)]) [self.previousDelegate windowDidChangeScreen:note]; Event(@"screenChanged", self.windowID); }
- (void)windowDidEnterFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidEnterFullScreen:)]) [self.previousDelegate windowDidEnterFullScreen:note]; Event(@"enterFullscreen", self.windowID); [self finishFullscreen:YES]; }
- (void)windowDidExitFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidExitFullScreen:)]) [self.previousDelegate windowDidExitFullScreen:note]; Event(@"leaveFullscreen", self.windowID); [self finishFullscreen:YES]; }
- (void)windowDidFailToEnterFullScreen:(NSWindow *)window { [self finishFullscreen:NO]; }
- (void)windowDidFailToExitFullScreen:(NSWindow *)window { [self finishFullscreen:NO]; }
- (void)windowDidMiniaturize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:_cmd]) [self.previousDelegate windowDidMiniaturize:note]; Event(@"visibilityChanged", self.windowID); }
- (void)windowDidDeminiaturize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:_cmd]) [self.previousDelegate windowDidDeminiaturize:note]; Event(@"visibilityChanged", self.windowID); }
- (void)windowDidBecomeKey:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidBecomeKey:)]) [self.previousDelegate windowDidBecomeKey:note]; Event(@"focus", self.windowID); }
- (void)windowDidResignKey:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidResignKey:)]) [self.previousDelegate windowDidResignKey:note]; Event(@"blur", self.windowID); }
@end
static void InstallDelegate(NSWindow *window, NSString *key) {
  if (!delegates) delegates = [NSMutableDictionary new];
  if (delegates[key] && delegates[key].window == window) return;
  SparkWindowDelegate *delegate = [SparkWindowDelegate new];
  delegate.window = window; delegate.windowID = key; delegate.instanceId = objc_getAssociatedObject(window, NSSelectorFromString(@"sparkWindowInstanceId")) ?: NSUUID.UUID.UUIDString;
  objc_setAssociatedObject(window, NSSelectorFromString(@"sparkWindowInstanceId"), delegate.instanceId, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  delegate.closeWaiters = [NSMutableArray new]; delegate.fullscreenWaiters = [NSMutableArray new];
  delegates[key] = delegate;
  delegate.previousDelegate = window.delegate;
  window.delegate = delegate;
}
extern "C" void SparkRebindWindowDelegate(NSWindow *window, NSString *key, id<NSWindowDelegate> delegate) {
  SparkWindowDelegate *guard = delegates[key];
  if (guard && guard.window == window) { guard.previousDelegate = delegate; window.delegate = guard; }
  else window.delegate = delegate;
}
static void RequestClose(NSWindow *window, NSString *key) {
  SparkWindowDelegate *delegate = delegates[key];
  if (delegate.guarded && !delegate.allowingClose) { [delegate requestClose]; return; }
  BOOL allow = ![delegate.previousDelegate respondsToSelector:@selector(windowShouldClose:)] || [delegate.previousDelegate windowShouldClose:window];
  if (!allow) { [delegate finishClose:NO]; return; }
  if (window.sheetParent) [window.sheetParent endSheet:window];
  [window close];
}
static NSDictionary *Info(NSString *key, NSWindow *window) {
  InstallDelegate(window, key);
  NSDictionary *opening = objc_getAssociatedObject(window, @selector(call:args:resolve:reject:));
  NSString *parentId = opening[@"parentId"];
  NSWindow *parent = window.sheetParent ?: window.parentWindow;
  for (NSString *candidate in windows) if (windows[candidate] == parent) { parentId = candidate; break; }
  return @{ @"id": key, @"instanceId": delegates[key].instanceId, @"kind": opening[@"kind"] ?: @"window",
    @"title": window.title, @"parentId": parentId ?: NSNull.null, @"modal": @([opening[@"modal"] boolValue]), @"visible": @(window.visible && !NSApp.hidden), @"focused": @(window.keyWindow),
    @"minimized": @(window.miniaturized), @"fullscreen": @((window.styleMask & NSWindowStyleMaskFullScreen) != 0), @"bounds": SparkBoundsForWindow(window) };
}
static BOOL ApplyCommon(NSWindow *window, NSDictionary *options, RCTPromiseRejectBlock reject) {
  NSSize minimum = options[@"minSize"] ? (options[@"minSize"] == NSNull.null ? NSMakeSize(100, 100) : NSMakeSize([options[@"minSize"][@"width"] doubleValue], [options[@"minSize"][@"height"] doubleValue])) : window.minSize;
  NSSize maximum = options[@"maxSize"] ? (options[@"maxSize"] == NSNull.null ? NSMakeSize(20000, 20000) : NSMakeSize([options[@"maxSize"][@"width"] doubleValue], [options[@"maxSize"][@"height"] doubleValue])) : window.maxSize;
  if (minimum.width > maximum.width || minimum.height > maximum.height) { reject(@"E_INVALID_ARGUMENT", @"Conflicting window constraints", nil); return NO; }
  if (options[@"title"]) window.title = options[@"title"];
  if (options[@"appearance"]) {
    NSString *appearance = options[@"appearance"];
    window.appearance = [appearance isEqual:@"dark"] ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua] : [appearance isEqual:@"light"] ? [NSAppearance appearanceNamed:NSAppearanceNameAqua] : nil;
  }
  NSWindowStyleMask mask = window.styleMask;
  if (options[@"titleBarStyle"]) {
    NSString *style = options[@"titleBarStyle"];
    mask &= ~(NSWindowStyleMaskTitled | NSWindowStyleMaskFullSizeContentView);
    if (![style isEqual:@"borderless"]) mask |= NSWindowStyleMaskTitled;
    if ([style isEqual:@"overlay"] || [style isEqual:@"hidden"]) mask |= NSWindowStyleMaskFullSizeContentView;
    window.titlebarAppearsTransparent = ![style isEqual:@"default"];
    window.titleVisibility = [style isEqual:@"default"] ? NSWindowTitleVisible : NSWindowTitleHidden;
  }
  for (NSString *key in @[@"resizable", @"closable", @"minimizable"]) if (options[key]) {
    NSWindowStyleMask bit = [key isEqual:@"resizable"] ? NSWindowStyleMaskResizable : [key isEqual:@"closable"] ? NSWindowStyleMaskClosable : NSWindowStyleMaskMiniaturizable;
    mask = [options[key] boolValue] ? mask | bit : mask & ~bit;
  }
  window.styleMask = mask;
  if (options[@"titleBarStyle"]) for (NSNumber *button in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)]) [window standardWindowButton:(NSWindowButton)button.integerValue].hidden = [options[@"titleBarStyle"] isEqual:@"hidden"];
  if (options[@"alwaysOnTop"]) window.level = [options[@"alwaysOnTop"] boolValue] ? NSFloatingWindowLevel : NSNormalWindowLevel;
  if (options[@"hasShadow"]) window.hasShadow = [options[@"hasShadow"] boolValue];
  if (options[@"transparent"]) { window.opaque = ![options[@"transparent"] boolValue]; window.backgroundColor = window.opaque ? NSColor.windowBackgroundColor : NSColor.clearColor; }
  if (options[@"backgroundColor"]) {
    NSString *color = options[@"backgroundColor"]; unsigned long long rgba = 0;
    [[NSScanner scannerWithString:[color substringFromIndex:1]] scanHexLongLong:&rgba]; if (color.length == 7) rgba = (rgba << 8) | 255;
    window.backgroundColor = [NSColor colorWithSRGBRed:((rgba >> 24) & 255) / 255.0 green:((rgba >> 16) & 255) / 255.0 blue:((rgba >> 8) & 255) / 255.0 alpha:(rgba & 255) / 255.0];
    window.opaque = (rgba & 255) == 255;
  }
  window.minSize = minimum; window.maxSize = maximum;
  NSRect frame = window.frame;
  frame.size.width = MIN(MAX(frame.size.width, minimum.width), maximum.width);
  frame.size.height = MIN(MAX(frame.size.height, minimum.height), maximum.height);
  [window setFrame:frame display:YES];
  return YES;
}
static BOOL SetBounds(NSWindow *window, NSDictionary *bounds, double durationMs, RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject) {
  NSScreen *screen = SparkScreenWithId(bounds[@"displayId"]);
  if (!screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return NO; }
  NSRect frame = SparkAppKitFrame(bounds, screen.frame);
  if (frame.size.width < window.minSize.width || frame.size.height < window.minSize.height || frame.size.width > window.maxSize.width || frame.size.height > window.maxSize.height) { reject(@"E_INVALID_ARGUMENT", @"Bounds are outside window constraints", nil); return NO; }
  if (durationMs > 0) [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) { context.duration = durationMs / 1000.0; [[window animator] setFrame:frame display:YES]; } completionHandler:^{ resolve(@"null"); }];
  else { [window setFrame:frame display:YES]; resolve(@"null"); }
  return YES;
}
@implementation RNDesktopWindows
RCT_EXPORT_MODULE(NativeDesktopWindowManager)
- (instancetype)init {
  if ((self = [super init])) {
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationVisibilityChanged:) name:NSApplicationDidHideNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationVisibilityChanged:) name:NSApplicationDidUnhideNotification object:nil];
  }
  return self;
}
- (void)applicationVisibilityChanged:(NSNotification *)notification {
  for (NSString *key in windows.allKeys) Event(@"visibilityChanged", key);
}
+ (BOOL)requiresMainQueueSetup { return YES; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    NSString *key = [args[@"id"] isKindOfClass:NSString.class] ? args[@"id"] : @"main";
    NSWindow *main = Window(@"main");
    if (main) InstallDelegate(main, @"main");
    if ([method isEqual:@"displays"]) { resolve(SparkJSON(SparkDisplayInfo())); return; }
    if ([method isEqual:@"cursorPoint"]) {
      resolve(SparkJSON(SparkCursorPoint()));
      return;
    }
    if ([method isEqual:@"list"]) {
      NSMutableArray *result = [NSMutableArray new];
      for (NSString *windowID in windows) [result addObject:Info(windowID, windows[windowID])];
      resolve(SparkJSON(result)); return;
    }
    NSWindow *window = Window(key);
    if (!window) { reject(@"E_NOT_FOUND", @"Window does not exist", nil); return; }
    InstallDelegate(window, key);
    SparkWindowDelegate *delegate = delegates[key];
    if (args[@"instanceId"] && ![args[@"instanceId"] isEqual:delegate.instanceId]) { reject(@"E_NOT_FOUND", @"Window instance has closed", nil); return; }
    if ([method isEqual:@"info"] || [method isEqual:@"observe"]) { resolve(SparkJSON(Info(key, window))); return; }
    if ([method isEqual:@"completeOpen"]) {
      NSWindow *parent = args[@"parentId"] ? Window(args[@"parentId"]) : nil;
      if (args[@"parentId"] && !parent) { reject(@"E_NOT_FOUND", @"Parent window not found", nil); return; }
      if ([args[@"modal"] boolValue] && parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
      window.minSize = NSMakeSize(100, 100); window.maxSize = NSMakeSize(20000, 20000);
      if (!ApplyCommon(window, args, reject)) return;
      NSDictionary *saved = [args[@"restoreBounds"] boolValue] ? [NSUserDefaults.standardUserDefaults dictionaryForKey:[NSString stringWithFormat:@"%@.bounds.%@", SparkNamespace(), key]] : nil;
      if (![saved[@"version"] isEqual:@1]) saved = nil;
      BOOL restoredShell = [objc_getAssociatedObject(window, NSSelectorFromString(@"sparkRestoredShell")) boolValue];
      if (!saved && restoredShell) {
        NSScreen *restoredScreen = SparkOwningScreen(window.frame);
        saved = @{ @"bounds": SparkLogicalBounds(window.frame, restoredScreen.frame, SparkScreenId(restoredScreen)), @"persistentId": SparkPersistentScreenId(restoredScreen) ?: @"" };
      }
      NSScreen *screen = args[@"position"] ? SparkScreenWithId(args[@"position"][@"displayId"]) : nil;
      if (args[@"position"] && !screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return; }
      if (!screen && saved) for (NSScreen *candidate in NSScreen.screens) if ([SparkPersistentScreenId(candidate) isEqual:saved[@"persistentId"]]) { screen = candidate; break; }
      if (!screen) screen = parent ? SparkOwningScreen(parent.frame) : SparkPrimaryScreen();
      NSDictionary *size = args[@"size"] ?: saved[@"bounds"];
      CGFloat width = size ? [size[@"width"] doubleValue] : 640, height = size ? [size[@"height"] doubleValue] : 480;
      width = MIN(MAX(width, window.minSize.width), window.maxSize.width); height = MIN(MAX(height, window.minSize.height), window.maxSize.height);
      NSRect frame = NSMakeRect(NSMidX(screen.visibleFrame) - width / 2, NSMidY(screen.visibleFrame) - height / 2, width, height);
      if (args[@"position"] || saved) {
        NSMutableDictionary *bounds = [(args[@"position"] ?: saved[@"bounds"]) mutableCopy]; bounds[@"width"] = @(width); bounds[@"height"] = @(height);
        frame = SparkAppKitFrame(bounds, screen.frame);
        if (!args[@"position"]) frame = [window constrainFrameRect:frame toScreen:screen];
      }
      [window setFrame:frame display:NO]; delegate.restoreBounds = [args[@"restoreBounds"] boolValue];
      if (parent && ![args[@"modal"] boolValue]) [parent addChildWindow:window ordered:NSWindowAbove];
      objc_setAssociatedObject(window, @selector(call:args:resolve:reject:), [args copy], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      if (![args[@"show"] isEqual:@NO]) {
        if ([args[@"modal"] boolValue]) [parent beginSheet:window completionHandler:nil]; else Show(window);
      } else [window orderOut:nil];
      Event(@"opened", key); Event(@"visibilityChanged", key); resolve(SparkJSON(Info(key, window))); return;
    }
    if ([method isEqual:@"discard"]) { delegate.guarded = NO; [window close]; return resolve(@"null"); }
    if ([method isEqual:@"close"]) { [delegate.closeWaiters addObject:[resolve copy]]; RequestClose(window, key); return; }
    if ([method isEqual:@"closeGuard"]) {
      BOOL enable = [args[@"enabled"] boolValue];
      if (enable && delegate.guarded && ![delegate.guardId isEqual:args[@"guardId"]]) { reject(@"E_BUSY", @"Window already has a close guard", nil); return; }
      if (!enable && ![delegate.guardId isEqual:args[@"guardId"]]) return resolve(@"null");
      delegate.guarded = enable; delegate.guardId = enable ? args[@"guardId"] : nil; delegate.pending = NO; delegate.request++; [delegate finishClose:NO];
    } else if ([method isEqual:@"replyClose"]) {
      if (delegate.pending && delegate.request == [args[@"requestId"] unsignedIntegerValue] && [delegate.guardId isEqual:args[@"guardId"]]) {
        delegate.pending = NO;
        if ([args[@"allow"] boolValue]) { delegate.allowingClose = YES; RequestClose(window, key); delegate.allowingClose = NO; }
        else [delegate finishClose:NO];
      }
    } else if ([method isEqual:@"show"]) {
      [window deminiaturize:nil]; NSDictionary *opening = objc_getAssociatedObject(window, @selector(call:args:resolve:reject:));
      if ([opening[@"modal"] boolValue] && !window.sheetParent) {
        NSWindow *parent = Window(opening[@"parentId"]);
        if (!parent) { reject(@"E_NOT_FOUND", @"Parent window has closed", nil); return; }
        if (parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
        [parent beginSheet:window completionHandler:nil];
      } else if ([args[@"focus"] isEqual:@NO]) [window orderFront:nil]; else Show(window);
      Event(@"visibilityChanged", key);
    } else if ([method isEqual:@"options"]) { if (!ApplyCommon(window, args[@"options"], reject)) return; }
    else if ([method isEqual:@"maximize"]) { if (!window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"unmaximize"]) { if (window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"center"]) {
      NSScreen *screen = args[@"displayId"] ? SparkScreenWithId(args[@"displayId"]) : SparkOwningScreen(window.frame);
      if (!screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return; }
      NSRect frame = window.frame; frame.origin = NSMakePoint(NSMidX(screen.visibleFrame) - NSWidth(frame)/2, NSMidY(screen.visibleFrame) - NSHeight(frame)/2); [window setFrame:frame display:YES];
    } else if ([method isEqual:@"hide"]) {
      if (window.sheetParent) [window.sheetParent endSheet:window]; [window orderOut:nil]; Event(@"visibilityChanged", key);
    } else if ([method isEqual:@"minimize"]) [window miniaturize:nil];
    else if ([method isEqual:@"fullscreen"]) {
      BOOL target = [args[@"enabled"] boolValue];
      if (delegate.fullscreenTarget && delegate.fullscreenTarget.boolValue != target) { reject(@"E_BUSY", @"Another fullscreen transition is pending", nil); return; }
      if (delegate.fullscreenTarget || ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) != target) {
        [delegate.fullscreenWaiters addObject:@{ @"resolve": [resolve copy], @"reject": [reject copy] }];
        if (!delegate.fullscreenTarget) { delegate.fullscreenTarget = @(target); [window toggleFullScreen:nil]; }
        return;
      }
    } else if ([method isEqual:@"bounds"]) { SetBounds(window, args[@"bounds"], [args[@"durationMs"] doubleValue], resolve, reject); return; }
    else { SparkInvalid(reject, @"Unknown window operation"); return; }
    resolve(@"null");
  });
}
- (void)invalidate {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  dispatch_async(dispatch_get_main_queue(), ^{
    // Windows and Fabric surfaces belong to the application. Retire only guards
    // whose JavaScript handlers went away; the next runtime may register again.
    for (SparkWindowDelegate *delegate in delegates.allValues) {
      delegate.guarded = NO; delegate.pending = NO; delegate.request++; [delegate finishClose:NO]; [delegate finishFullscreen:NO];
    }
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopWindowManagerSpecJSI>(params);
}
@end
