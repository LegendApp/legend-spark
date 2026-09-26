#import "RNDesktopWindows.h"
#import "window-manager/LegendWindowRegistry.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#import <React/RCTSurfaceHostingView.h>

// Overlay controls accept mouse input without taking keyboard focus from an app.
@interface SparkOverlayPanel : NSPanel
@end
@implementation SparkOverlayPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end
static void Show(NSWindow *window) {
  if ([window isKindOfClass:SparkOverlayPanel.class]) [window orderFrontRegardless];
  else [window makeKeyAndOrderFront:nil];
}
@protocol SparkRootFactory
- (RCTRootViewFactory *)rootViewFactory;
@end
@interface SparkWindowDelegate : NSObject <NSWindowDelegate>
@property NSString *windowID;
@property (nonatomic, weak) id<NSWindowDelegate> previousDelegate;
@property BOOL guarded;
@property BOOL allowingClose;
@property NSUInteger request;
@property BOOL pending;
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
static void Event(NSString *type, NSString *key) { SparkEmit(@{ @"type": type, @"windowId": key }); }
@implementation SparkWindowDelegate
- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || [self.previousDelegate respondsToSelector:selector]; }
- (id)forwardingTargetForSelector:(SEL)selector { return [self.previousDelegate respondsToSelector:selector] ? self.previousDelegate : [super forwardingTargetForSelector:selector]; }
- (void)requestClose {
  if (self.pending) return;
  self.pending = YES; NSUInteger request = ++self.request;
  SparkEmit(@{ @"type": @"beforeClose", @"windowId": self.windowID, @"requestId": @(request) });
  __weak SparkWindowDelegate *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    SparkWindowDelegate *delegate = weakSelf;
    if (delegate.request == request) delegate.pending = NO;
  });
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
  if (self.guarded && !self.allowingClose) { [self requestClose]; return NO; }
  return [self.previousDelegate respondsToSelector:@selector(windowShouldClose:)] ? [self.previousDelegate windowShouldClose:sender] : YES;
}
- (void)windowWillClose:(NSNotification *)note {
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
  if (![self.windowID isEqual:@"main"]) {
    // Retain the proxy until its delegate callback returns.
    dispatch_async(dispatch_get_main_queue(), ^{
      if (delegates[self.windowID] == self) [delegates removeObjectForKey:self.windowID];
    });
  }
}
- (void)windowDidMove:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidMove:)]) [self.previousDelegate windowDidMove:note]; Event(@"move", self.windowID); }
- (void)windowDidResize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidResize:)]) [self.previousDelegate windowDidResize:note]; Event(@"resize", self.windowID); }
- (void)windowDidChangeScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidChangeScreen:)]) [self.previousDelegate windowDidChangeScreen:note]; Event(@"screenChanged", self.windowID); }
- (void)windowDidEnterFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidEnterFullScreen:)]) [self.previousDelegate windowDidEnterFullScreen:note]; Event(@"enterFullscreen", self.windowID); }
- (void)windowDidExitFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidExitFullScreen:)]) [self.previousDelegate windowDidExitFullScreen:note]; Event(@"leaveFullscreen", self.windowID); }
- (void)windowDidBecomeKey:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidBecomeKey:)]) [self.previousDelegate windowDidBecomeKey:note]; Event(@"focus", self.windowID); }
- (void)windowDidResignKey:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidResignKey:)]) [self.previousDelegate windowDidResignKey:note]; Event(@"blur", self.windowID); }
@end
static void InstallDelegate(NSWindow *window, NSString *key) {
  if (!delegates) delegates = [NSMutableDictionary new];
  if (delegates[key]) return;
  SparkWindowDelegate *delegate = [SparkWindowDelegate new];
  delegate.windowID = key;
  delegates[key] = delegate;
  delegate.previousDelegate = window.delegate;
  window.delegate = delegate;
}
extern "C" void SparkRebindWindowDelegate(NSWindow *window, NSString *key, id<NSWindowDelegate> delegate) {
  SparkWindowDelegate *guard = delegates[key];
  if (guard) { guard.previousDelegate = delegate; window.delegate = guard; }
  else window.delegate = delegate;
}
static void RequestClose(NSWindow *window, NSString *key) {
  SparkWindowDelegate *delegate = delegates[key];
  if (delegate.guarded && !delegate.allowingClose) { [delegate requestClose]; return; }
  if (window.sheetParent) [window.sheetParent endSheet:window];
  [window performClose:nil];
}
static NSDictionary *Frame(NSRect frame) {
  return @{ @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) };
}
static NSDictionary *Info(NSString *key, NSWindow *window) {
  return @{ @"id": key, @"kind": [window isKindOfClass:SparkOverlayPanel.class] ? @"overlay" : @"window", @"title": window.title, @"visible": @(window.visible), @"focused": @(window.keyWindow),
    @"resizable": @((window.styleMask & NSWindowStyleMaskResizable) != 0), @"alwaysOnTop": @(window.level >= NSFloatingWindowLevel),
    @"minWidth": @(window.contentMinSize.width), @"maxWidth": @(window.contentMaxSize.width),
    @"minimized": @(window.miniaturized), @"fullscreen": @((window.styleMask & NSWindowStyleMaskFullScreen) != 0), @"frame": Frame(window.frame) };
}
@implementation RNDesktopWindows
RCT_EXPORT_MODULE(NativeDesktopWindowManager)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    NSString *key = [args[@"id"] isKindOfClass:NSString.class] ? args[@"id"] : @"main";
    NSWindow *main = Window(@"main");
    // Reading windows must not replace the host lifecycle delegate.
    if ([method isEqual:@"displays"]) {
      NSMutableArray *result = [NSMutableArray new];
      for (NSScreen *screen in NSScreen.screens) [result addObject:@{ @"id": [screen.deviceDescription[@"NSScreenNumber"] stringValue],
        @"name": screen.localizedName, @"frame": Frame(screen.frame), @"workArea": Frame(screen.visibleFrame), @"scale": @(screen.backingScaleFactor) }];
      resolve(SparkJSON(result)); return;
    }
    if ([method isEqual:@"list"]) {
      NSMutableArray *result = [NSMutableArray new];
      for (NSString *windowID in windows) [result addObject:Info(windowID, windows[windowID])];
      resolve(SparkJSON(result)); return;
    }
    NSWindow *window = Window(key);
    if ([method isEqual:@"open"]) {
      if (!key.length || [key isEqual:@"main"]) { SparkInvalid(reject, @"Secondary windows need a non-main id"); return; }
      NSWindow *parent = args[@"parentId"] ? Window(args[@"parentId"]) : nil;
      if (args[@"parentId"] && !parent) { reject(@"E_NOT_FOUND", @"Parent window not found", nil); return; }
      if (parent && parent == window) { SparkInvalid(reject, @"Invalid parent window"); return; }
      if ([args[@"modal"] boolValue] && (!parent || parent.attachedSheet)) { reject(@"E_BUSY", @"Modal window requires an available parent", nil); return; }
      if (!window) {
        id delegate = NSApp.delegate;
        if (![delegate respondsToSelector:@selector(rootViewFactory)]) { reject(@"E_HOST", @"Host has no React root factory", nil); return; }
        CGFloat width = args[@"width"] ? [args[@"width"] doubleValue] : 640;
        CGFloat height = args[@"height"] ? [args[@"height"] doubleValue] : 480;
        BOOL overlay = [args[@"kind"] isEqual:@"overlay"];
        if (overlay && [args[@"modal"] boolValue]) { SparkInvalid(reject, @"An overlay cannot be modal"); return; }
        window = [[(overlay ? SparkOverlayPanel.class : NSWindow.class) alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
          styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | (overlay ? NSWindowStyleMaskNonactivatingPanel : 0)
          backing:NSBackingStoreBuffered defer:NO];
        if (overlay) {
          ((NSPanel *)window).hidesOnDeactivate = NO;
          window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        }
        window.releasedWhenClosed = NO;
        window.identifier = [@"spark." stringByAppendingString:key];
        window.title = args[@"title"] ?: SparkContext()[@"name"];
        window.contentView = [(id<SparkRootFactory>)delegate rootViewFactory] ? [[(id<SparkRootFactory>)delegate rootViewFactory]
          viewWithModuleName:@"main" initialProperties:SparkInitialProps(key, args[@"props"])] : nil;
        window.contentView = SparkWindowContent(window.contentView);
        SparkApplyWindowOptions(window, args);
        SparkRestoreWindow(window, key, args);
        windows[key] = window;
        LegendWindowRegistry.sharedRegistry.rootViews[key] = window.contentView;
        InstallDelegate(window, key);
        Event(@"opened", key);
      }
      if ([args[@"modal"] boolValue]) [parent beginSheet:window completionHandler:nil];
      else { NSInteger level = window.level; if (parent) [parent addChildWindow:window ordered:NSWindowAbove]; Show(window); window.level = level; }
      resolve(SparkJSON(Info(key, window))); return;
    }
    if (!window) { reject(@"E_NOT_FOUND", @"Window does not exist", nil); return; }
    if ([method isEqual:@"info"]) { resolve(SparkJSON(Info(key, window))); return; }
    if ([method isEqual:@"close"]) RequestClose(window, key);
    else if ([method isEqual:@"closeGuard"]) { InstallDelegate(window, key); delegates[key].guarded = [args[@"enabled"] boolValue]; delegates[key].pending = NO; delegates[key].request++; }
    else if ([method isEqual:@"replyClose"]) {
      SparkWindowDelegate *delegate = delegates[key];
      if (delegate.pending && delegate.request == [args[@"requestId"] unsignedIntegerValue]) {
        delegate.pending = NO;
        if ([args[@"allow"] boolValue]) { delegate.allowingClose = YES; RequestClose(window, key); delegate.allowingClose = NO; }
      }
    }
    else if ([method isEqual:@"show"]) { [window deminiaturize:nil]; Show(window); }
    else if ([method isEqual:@"options"]) SparkApplyWindowOptions(window, args[@"options"]);
    else if ([method isEqual:@"maximize"]) { if (!window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"unmaximize"]) { if (window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"center"]) [window center];
    else if ([method isEqual:@"hide"]) [window orderOut:nil];
    else if ([method isEqual:@"minimize"]) [window miniaturize:nil];
    else if ([method isEqual:@"fullscreen"]) {
      BOOL current = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
      if (current != [args[@"enabled"] boolValue]) [window toggleFullScreen:nil];
    }
    else if ([method isEqual:@"title"]) window.title = args[@"title"] ?: @"";
    else if ([method isEqual:@"frame"]) {
      NSDictionary *frame = args[@"frame"];
      [window setFrame:NSMakeRect([frame[@"x"] doubleValue], [frame[@"y"] doubleValue], [frame[@"width"] doubleValue], [frame[@"height"] doubleValue]) display:YES];
    }
    else { SparkInvalid(reject, @"Unknown window operation"); return; }
    resolve(@"null");
  });
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Windows and Fabric surfaces belong to the application. Retire only guards
    // whose JavaScript handlers went away; the next runtime may register again.
    for (SparkWindowDelegate *delegate in delegates.allValues) {
      delegate.guarded = NO; delegate.pending = NO; delegate.request++;
    }
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopWindowManagerSpecJSI>(params);
}
@end
