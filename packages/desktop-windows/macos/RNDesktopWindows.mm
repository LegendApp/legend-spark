#import "RNDesktopWindows.h"
#import "window-manager/LegendWindowRegistry.h"
#import "SparkWindowGeometry.h"
#import "SparkDisplays.h"
#import <objc/runtime.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#import <React/RCTSurfaceHostingView.h>
#import <React/RCTRootView.h>
#import <mach/mach.h>

static NSArray<NSWindow *> *TabWindows(NSWindow *window);
static void SelectTab(NSWindow *window);
static void DetachTab(NSWindow *window);
static BOOL Park(NSWindow *window, NSString *key);
// Driver mode records the window as shown instead of ordering it on screen (docs/test-driver.md).
// Ordering a tab front selects it, so the driver records that too.
static void Show(NSWindow *window, BOOL focus, NSWindow *sheetParent) {
  if (SparkTestDriverActive()) { SparkSetDriverShown(window, YES); if (TabWindows(window).count > 1) SelectTab(window); return; }
  if (sheetParent) [sheetParent beginSheet:window completionHandler:nil];
  else if (!focus) [window orderFront:nil];
  else if ([window isKindOfClass:NSPanel.class] && (window.styleMask & NSWindowStyleMaskNonactivatingPanel)) {
    // A non-activating panel takes key focus without activating the app (a command bar over another app's window).
    // Borderless panels cannot become key; they are only ordered front.
    [window orderFrontRegardless];
    if (window.canBecomeKeyWindow) [window makeKeyWindow];
  }
  else [window makeKeyAndOrderFront:nil];
}
static void Hide(NSWindow *window) {
  SparkSetDriverShown(window, NO);
  // A hidden window leaves its tab group, as AppKit does on orderOut.
  if (SparkTestDriverActive()) DetachTab(window);
  if (window.sheetParent) [window.sheetParent endSheet:window];
  [window orderOut:nil];
}
// Driver mode reports what the app did (docs/test-driver.md): a driven app runs with no presence, which AppKit
// reports as hidden.
static BOOL Visible(NSWindow *window) { return SparkTestDriverActive() ? SparkDriverShown(window) : window.visible && !NSApp.hidden; }
static char SimpleFullscreenKey, TrafficLightKey, MaterialKey, CornerSnapKey;
static void SnapToCorner(NSWindow *window);
static BOOL InSimpleFullscreen(NSWindow *window) { return objc_getAssociatedObject(window, &SimpleFullscreenKey) != nil; }
static void SetSimpleFullscreen(NSWindow *window, BOOL enabled);
static void SetTrafficLightPosition(NSWindow *window, id position);
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
// The new-tab handler that shows the tab bar's + button, and the tab group last published.
@property NSString *tabHandlerId;
@property NSDictionary *tabState;
@property BOOL observingTabs;
@property NSDictionary *restoringTabs;
// A window pool keeps this window: closing hides it and ends its instance instead (docs/api-window-contract.md#window-pools).
@property BOOL parkOnClose;
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
static BOOL Terminating;
static NSString *SavedStateKey(NSString *key) { return [NSString stringWithFormat:@"%@.bounds.%@", SparkNamespace(), key]; }
// restoreBounds keeps one record per window ID: its windowed frame and, while it shares a tab
// group, the group's window IDs in tab order and whether it was the selected tab.
static void SaveState(NSString *key) {
  NSWindow *window = Window(key); SparkWindowDelegate *delegate = delegates[key];
  if (!delegate.restoreBounds || Terminating) return;
  NSMutableDictionary *record = [[NSUserDefaults.standardUserDefaults dictionaryForKey:SavedStateKey(key)] mutableCopy];
  if (![record[@"version"] isEqual:@1]) record = [@{ @"version": @1 } mutableCopy];
  if (!window.miniaturized && !(window.styleMask & NSWindowStyleMaskFullScreen) && !InSimpleFullscreen(window)) {
    record[@"bounds"] = SparkWindowBounds(window); record[@"persistentId"] = SparkOwning(window.frame).persistentId ?: @"";
  }
  if (!record[@"bounds"]) return;
  NSArray *tabs = delegate.tabState[@"windowIds"];
  if (tabs.count > 1) { record[@"tabs"] = tabs; record[@"selected"] = @([delegate.tabState[@"selectedWindowId"] isEqual:key]); }
  else [record removeObjectsForKeys:@[@"tabs", @"selected"]];
  [NSUserDefaults.standardUserDefaults setObject:record forKey:SavedStateKey(key)];
}
static void Event(NSString *type, NSString *key) {
  NSWindow *window = Window(key);
  NSMutableDictionary *event = [@{ @"type": type, @"windowId": key, @"instanceId": delegates[key].instanceId ?: @"" } mutableCopy];
  if ([type isEqual:@"move"] || [type isEqual:@"resize"] || [type isEqual:@"screenChanged"]) {
    event[@"type"] = @"boundsChanged"; event[@"bounds"] = SparkWindowBounds(window);
    SaveState(key);
  } else if ([type isEqual:@"focus"] || [type isEqual:@"blur"]) { event[@"type"] = @"focusChanged"; event[@"focused"] = @([type isEqual:@"focus"]); }
  else if ([type isEqual:@"enterFullscreen"] || [type isEqual:@"leaveFullscreen"]) { event[@"type"] = @"fullscreenChanged"; event[@"fullscreen"] = @([type isEqual:@"enterFullscreen"]); }
  else if ([type isEqual:@"visibilityChanged"]) event[@"visible"] = @(Visible(window));
  else if ([type isEqual:@"occlusionChanged"]) event[@"occluded"] = @((window.occlusionState & NSWindowOcclusionStateVisible) == 0);
  SparkEmit(event);
}
// Native window tabs (docs/api-window-contract.md#window-tabs). Only Spark windows have IDs, so a
// group lists its Spark windows; a window that is not tabbed is a group of one.
// The registry is shared with other modules, so the window remembers its last key, checked on each use.
static char WindowKeyKey;
static NSString *KeyFor(NSWindow *window) {
  NSString *key = objc_getAssociatedObject(window, &WindowKeyKey);
  if (key && windows[key] == window) return key;
  key = [windows allKeysForObject:window].firstObject;
  objc_setAssociatedObject(window, &WindowKeyKey, key, OBJC_ASSOCIATION_COPY_NONATOMIC);
  return key;
}
static NSArray<NSWindow *> *TabWindows(NSWindow *window) {
  NSArray<NSWindow *> *tabs = window.tabGroup.windows;
  return [tabs containsObject:window] ? tabs : @[window];
}
// Selecting a tab orders it on screen, which driver mode never does: the driver records each selection
// and reports the group's most recently selected tab (AppKit's selection until it records one).
static char DriverSelectionKey;
static NSUInteger DriverSelections;
static void ScheduleTabs(void);
static void SelectTab(NSWindow *window) {
  if (SparkTestDriverActive()) { objc_setAssociatedObject(window, &DriverSelectionKey, @(++DriverSelections), OBJC_ASSOCIATION_RETAIN_NONATOMIC); ScheduleTabs(); }
  else window.tabGroup.selectedWindow = window;
}
static NSWindow *SelectedTab(NSWindow *window) {
  NSArray<NSWindow *> *tabs = TabWindows(window);
  if (tabs.count == 1) return window;
  NSWindow *selected = window.tabGroup.selectedWindow;
  if (!SparkTestDriverActive()) return selected;
  NSUInteger latest = 0;
  for (NSWindow *tab in tabs) {
    NSUInteger order = [objc_getAssociatedObject(tab, &DriverSelectionKey) unsignedIntegerValue];
    if (order > latest) { latest = order; selected = tab; }
  }
  return selected;
}
// Driver mode: when AppKit's selected window leaves a group, AppKit orders the next tab on screen.
// So the other tabs leave instead, and regroup in order behind the first of them.
static void DetachTab(NSWindow *window) {
  NSArray<NSWindow *> *tabs = TabWindows(window);
  if (tabs.count < 2) return;
  if (window.tabGroup.selectedWindow != window) { [window.tabGroup removeWindow:window]; return; }
  NSMutableArray<NSWindow *> *rest = [tabs mutableCopy]; [rest removeObject:window];
  for (NSWindow *tab in rest) [window.tabGroup removeWindow:tab];
  for (NSWindow *tab in rest) if (tab != rest.firstObject) [rest.firstObject.tabGroup addWindow:tab];
}
static NSDictionary *TabGroup(NSWindow *window) {
  NSMutableArray *ids = [NSMutableArray new];
  for (NSWindow *tab in TabWindows(window)) { NSString *key = KeyFor(tab); if (key) [ids addObject:key]; }
  return @{ @"windowIds": ids, @"selectedWindowId": KeyFor(SelectedTab(window)) ?: NSNull.null, @"tabBarVisible": @(window.tabGroup.tabBarVisible) };
}
// Publishes what changed since the last publication of each window, once per main-loop turn.
static BOOL TabsScheduled;
static void PublishTabs(void) {
  TabsScheduled = NO;
  Window(@"main");
  for (NSString *key in windows.allKeys) {
    SparkWindowDelegate *delegate = delegates[key]; NSWindow *window = windows[key];
    if (!delegate.observingTabs || delegate.window != window) continue;
    NSDictionary *previous = delegate.tabState, *next = TabGroup(window);
    if ([previous isEqual:next]) continue;
    delegate.tabState = next;
    if (![previous[@"windowIds"] isEqual:next[@"windowIds"]] || ![previous[@"tabBarVisible"] isEqual:next[@"tabBarVisible"]])
      SparkEmit(@{ @"type": @"tabGroupChanged", @"windowId": key, @"instanceId": delegate.instanceId, @"tabGroup": next });
    if (![previous[@"selectedWindowId"] isEqual:next[@"selectedWindowId"]])
      SparkEmit(@{ @"type": @"tabSelectionChanged", @"windowId": key, @"instanceId": delegate.instanceId, @"selectedWindowId": next[@"selectedWindowId"] });
    SaveState(key);
  }
}
// Driver mode never shows windows, and AppKit's merge orders them on screen: join every shown Spark
// window that can tab with the target instead, in creation order. Merge leaves hidden windows alone too.
static void MergeShownWindows(NSWindow *target) {
  NSMutableArray<NSWindow *> *candidates = [NSMutableArray new];
  for (NSString *key in windows) {
    NSWindow *window = windows[key];
    if (![window isKindOfClass:NSWindow.class] || [TabWindows(target) containsObject:window] || !SparkDriverShown(window) || window.parentWindow || window.sheetParent
      || window.tabbingMode == NSWindowTabbingModeDisallowed || ![window.tabbingIdentifier isEqual:target.tabbingIdentifier]) continue;
    [candidates addObject:window];
  }
  [candidates sortUsingComparator:^NSComparisonResult(NSWindow *a, NSWindow *b) { return [@(a.windowNumber) compare:@(b.windowNumber)]; }];
  NSWindow *selected = SelectedTab(target);
  for (NSWindow *window in candidates) { DetachTab(window); [target.tabGroup addWindow:window]; }
  if (candidates.count) SelectTab(selected);
}
static void ScheduleTabs(void) {
  if (TabsScheduled) return;
  TabsScheduled = YES;
  dispatch_async(dispatch_get_main_queue(), ^{ PublishTabs(); });
}
static NSArray<NSString *> *TabKeyPaths(void) { return @[@"tabGroup.windows", @"tabGroup.selectedWindow", @"tabGroup.tabBarVisible"]; }
static char TabObservation;
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

- (BOOL)respondsToSelector:(SEL)selector {
  // The tab bar shows its + button only while something in the responder chain answers newWindowForTab:.
  if (selector == @selector(newWindowForTab:)) return self.tabHandlerId != nil || [self.previousDelegate respondsToSelector:selector];
  return [super respondsToSelector:selector] || [self.previousDelegate respondsToSelector:selector];
}
- (void)newWindowForTab:(id)sender {
  if (!self.tabHandlerId) { [(id)self.previousDelegate newWindowForTab:sender]; return; }
  SparkEmit(@{ @"type": @"newTabRequested", @"windowId": self.windowID, @"instanceId": self.instanceId, @"handlerId": self.tabHandlerId });
}
// AppKit has no tab notifications; tab groups are key-value observable.
- (void)observeTabs:(BOOL)observe {
  NSWindow *window = self.window;
  if (observe == self.observingTabs || ![window isKindOfClass:NSWindow.class]) return;
  self.observingTabs = observe;
  for (NSString *path in TabKeyPaths()) {
    if (observe) [window addObserver:self forKeyPath:path options:0 context:&TabObservation];
    else [window removeObserver:self forKeyPath:path context:&TabObservation];
  }
}
- (void)observeValueForKeyPath:(NSString *)path ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (context == &TabObservation) ScheduleTabs();
  else [super observeValueForKeyPath:path ofObject:object change:change context:context];
}
- (void)dealloc { [self observeTabs:NO]; }
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
  BOOL allow = [self.previousDelegate respondsToSelector:@selector(windowShouldClose:)] ? [self.previousDelegate windowShouldClose:sender] : YES;
  return allow && !Park(sender, self.windowID);
}
- (void)windowWillClose:(NSNotification *)note {
  [self finishClose:YES]; [self finishFullscreen:NO]; [self observeTabs:NO];
  // A window the user closes leaves its tab group for good; quitting keeps the saved group.
  if (self.restoreBounds && !Terminating) {
    NSMutableDictionary *record = [[NSUserDefaults.standardUserDefaults dictionaryForKey:SavedStateKey(self.windowID)] mutableCopy];
    if (record[@"tabs"]) { [record removeObjectsForKeys:@[@"tabs", @"selected"]]; [NSUserDefaults.standardUserDefaults setObject:record forKey:SavedStateKey(self.windowID)]; }
  }
  // Give back the app-wide presentation options and saved frame, and stop layout observers.
  SetSimpleFullscreen(note.object, NO); SetTrafficLightPosition(note.object, NSNull.null);
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
- (void)windowDidMove:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidMove:)]) [self.previousDelegate windowDidMove:note]; Event(@"move", self.windowID); SnapToCorner(self.window); }
- (void)windowDidResize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidResize:)]) [self.previousDelegate windowDidResize:note]; Event(@"resize", self.windowID); }
- (void)windowDidChangeScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidChangeScreen:)]) [self.previousDelegate windowDidChangeScreen:note]; Event(@"screenChanged", self.windowID); }
- (void)windowDidEnterFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidEnterFullScreen:)]) [self.previousDelegate windowDidEnterFullScreen:note]; Event(@"enterFullscreen", self.windowID); [self finishFullscreen:YES]; }
- (void)windowDidExitFullScreen:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:@selector(windowDidExitFullScreen:)]) [self.previousDelegate windowDidExitFullScreen:note]; Event(@"leaveFullscreen", self.windowID); [self finishFullscreen:YES]; }
- (void)windowDidFailToEnterFullScreen:(NSWindow *)window { [self finishFullscreen:NO]; }
- (void)windowDidFailToExitFullScreen:(NSWindow *)window { [self finishFullscreen:NO]; }
- (void)windowDidMiniaturize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:_cmd]) [self.previousDelegate windowDidMiniaturize:note]; Event(@"visibilityChanged", self.windowID); }
- (void)windowDidDeminiaturize:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:_cmd]) [self.previousDelegate windowDidDeminiaturize:note]; Event(@"visibilityChanged", self.windowID); }
// AppKit reports occlusion only for windows on screen; driver mode never shows one, so it reports none.
- (void)windowDidChangeOcclusionState:(NSNotification *)note { if ([self.previousDelegate respondsToSelector:_cmd]) [self.previousDelegate windowDidChangeOcclusionState:note]; if (!SparkTestDriverActive()) Event(@"occlusionChanged", self.windowID); }
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
  delegate.tabState = [window isKindOfClass:NSWindow.class] ? TabGroup(window) : nil;
  [delegate observeTabs:YES];
}
extern "C" void SparkRebindWindowDelegate(NSWindow *window, NSString *key, id<NSWindowDelegate> delegate) {
  SparkWindowDelegate *guard = delegates[key];
  if (guard && guard.window == window) { guard.previousDelegate = delegate; window.delegate = guard; }
  else window.delegate = delegate;
}
// Parks a pooled window instead of closing it: the instance ends exactly as on close (waiters resolve closed, the closed
// event goes to its listeners, guards and the new-tab handler go away), the window is hidden, and the next use gets a
// new instance token. Fullscreen, minimized and sheet windows close for real.
static BOOL Park(NSWindow *window, NSString *key) {
  SparkWindowDelegate *delegate = delegates[key];
  if (!delegate.parkOnClose || Terminating || (window.styleMask & NSWindowStyleMaskFullScreen) || InSimpleFullscreen(window) || window.miniaturized || window.sheetParent) return NO;
  [delegate finishClose:YES]; [delegate finishFullscreen:NO];
  Hide(window);
  if (window.parentWindow) [window.parentWindow removeChildWindow:window];
  window.documentEdited = NO;
  Event(@"closed", key);
  delegate.instanceId = NSUUID.UUID.UUIDString;
  objc_setAssociatedObject(window, NSSelectorFromString(@"sparkWindowInstanceId"), delegate.instanceId, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  delegate.guarded = NO; delegate.guardId = nil; delegate.pending = NO; delegate.request++; delegate.tabHandlerId = nil;
  return YES;
}
static void RequestClose(NSWindow *window, NSString *key) {
  SparkWindowDelegate *delegate = delegates[key];
  if (delegate.guarded && !delegate.allowingClose) { [delegate requestClose]; return; }
  BOOL allow = ![delegate.previousDelegate respondsToSelector:@selector(windowShouldClose:)] || [delegate.previousDelegate windowShouldClose:window];
  if (!allow) { [delegate finishClose:NO]; return; }
  if (window.sheetParent) [window.sheetParent endSheet:window];
  // AppKit removes a closing tab from its group before windowWillClose:, ordering the next tab on screen.
  if (SparkTestDriverActive()) DetachTab(window);
  if (!Park(window, key)) [window close];
}
static NSDictionary *Info(NSString *key, NSWindow *window) {
  InstallDelegate(window, key);
  NSDictionary *opening = objc_getAssociatedObject(window, @selector(call:args:resolve:reject:));
  NSString *parentId = opening[@"parentId"];
  NSWindow *parent = window.sheetParent ?: window.parentWindow;
  for (NSString *candidate in windows) if (windows[candidate] == parent) { parentId = candidate; break; }
  return @{ @"id": key, @"instanceId": delegates[key].instanceId, @"kind": opening[@"kind"] ?: @"window",
    @"title": window.title, @"parentId": parentId ?: NSNull.null, @"modal": @([opening[@"modal"] boolValue]), @"visible": @(Visible(window)), @"focused": @(window.keyWindow),
    @"minimized": @(window.miniaturized), @"maximized": @(window.zoomed), @"fullscreen": @((window.styleMask & NSWindowStyleMaskFullScreen) != 0), @"bounds": SparkWindowBounds(window) };
}
static const NSWindowButton TrafficLights[] = { NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton };
// Holds a requested traffic-light position and puts the buttons back whenever AppKit lays the
// title bar out again (resize, toolbar and title changes, fullscreen exit, recreated buttons).
@interface SparkTrafficLights : NSObject
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic) NSPoint position;
@property (nonatomic, weak) NSButton *observed;
@property (nonatomic) NSArray<NSNumber *> *original; // AppKit's container height, close button leading x and y, spacing
@property (nonatomic) NSMutableArray *windowObservers, *viewObservers;
@property (nonatomic) BOOL scheduled;
@end
@implementation SparkTrafficLights
// Lay out now, and once more after the current layout pass: AppKit can move the buttons again
// later in the same pass (for example while adding a toolbar), ignoring changes made during it.
- (void)observe:(id)object name:(NSNotificationName)name into:(NSMutableArray *)tokens {
  __weak SparkTrafficLights *weakSelf = self;
  [tokens addObject:[NSNotificationCenter.defaultCenter addObserverForName:name object:object queue:nil usingBlock:^(NSNotification *) {
    SparkTrafficLights *lights = weakSelf;
    [lights layout];
    if (!lights || lights.scheduled) return;
    lights.scheduled = YES;
    dispatch_async(dispatch_get_main_queue(), ^{ SparkTrafficLights *later = weakSelf; later.scheduled = NO; [later layout]; });
  }]];
}
- (void)stop:(NSMutableArray *)tokens { for (id token in tokens) [NSNotificationCenter.defaultCenter removeObserver:token]; [tokens removeAllObjects]; }
// Puts the close button `x` from the container's leading edge and `y` up from its bottom; the
// other buttons keep AppKit's spacing. Right-to-left title bars put the close button at the right.
- (void)place:(CGFloat)height x:(CGFloat)x y:(CGFloat)y spacing:(CGFloat)spacing {
  NSWindow *window = self.window; NSButton *close = [window standardWindowButton:NSWindowCloseButton]; NSView *container = close.superview.superview;
  NSRect frame = container.frame; frame.size.height = height; frame.origin.y = NSHeight(window.frame) - height;
  if (!NSEqualRects(frame, container.frame)) container.frame = frame;
  CGFloat start = window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft ? NSWidth(frame) - x - NSWidth(close.frame) : x;
  for (int index = 0; index < 3; index++) {
    NSButton *button = [window standardWindowButton:TrafficLights[index]];
    NSPoint origin = NSMakePoint(start + index * spacing, y);
    if (button && !NSEqualPoints(origin, button.frame.origin)) [button setFrameOrigin:origin];
  }
}
- (CGFloat)spacing {
  NSButton *close = [self.window standardWindowButton:NSWindowCloseButton], *minimize = [self.window standardWindowButton:NSWindowMiniaturizeButton];
  return minimize ? NSMinX(minimize.frame) - NSMinX(close.frame) : 0;
}
- (void)layout {
  NSWindow *window = self.window;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSView *container = close.superview.superview;
  if (!container || (window.styleMask & NSWindowStyleMaskFullScreen)) return;
  if (close != self.observed) {
    // AppKit recreates the buttons after closable, minimizable and resizable were all off.
    [self stop:self.viewObservers]; self.observed = close;
    BOOL rtl = window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
    self.original = @[@(NSHeight(container.frame)), @(rtl ? NSWidth(container.frame) - NSMaxX(close.frame) : NSMinX(close.frame)), @(NSMinY(close.frame)), @(self.spacing)];
    for (NSView *view in @[close, container]) { view.postsFrameChangedNotifications = YES; [self observe:view name:NSViewFrameDidChangeNotification into:self.viewObservers]; }
  }
  // The container grows to center the buttons at the requested top inset (Electron's layout).
  [self place:NSHeight(close.frame) + 2 * self.position.y x:self.position.x y:self.position.y spacing:self.spacing];
}
- (void)remove {
  [self stop:self.windowObservers]; [self stop:self.viewObservers];
  NSWindow *window = self.window;
  if (self.observed && self.observed == [window standardWindowButton:NSWindowCloseButton] && !(window.styleMask & NSWindowStyleMaskFullScreen))
    [self place:[self.original[0] doubleValue] x:[self.original[1] doubleValue] y:[self.original[2] doubleValue] spacing:[self.original[3] doubleValue]];
}
@end
// Close button offset from the window's leading top corner; null restores AppKit's layout.
static void SetTrafficLightPosition(NSWindow *window, id position) {
  SparkTrafficLights *lights = objc_getAssociatedObject(window, &TrafficLightKey);
  if (position == NSNull.null) { [lights remove]; objc_setAssociatedObject(window, &TrafficLightKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC); return; }
  if (!lights) {
    lights = [SparkTrafficLights new]; lights.window = window; lights.windowObservers = [NSMutableArray new]; lights.viewObservers = [NSMutableArray new];
    for (NSNotificationName name in @[NSWindowDidResizeNotification, NSWindowDidExitFullScreenNotification]) [lights observe:window name:name into:lights.windowObservers];
    objc_setAssociatedObject(window, &TrafficLightKey, lights, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  lights.position = NSMakePoint([position[@"x"] doubleValue], [position[@"y"] doubleValue]);
  [lights layout];
}
static void SetBackgroundMaterial(NSWindow *window, NSString *name) {
  NSDictionary *materials = @{ @"sidebar": @(NSVisualEffectMaterialSidebar), @"windowBackground": @(NSVisualEffectMaterialWindowBackground), @"hudWindow": @(NSVisualEffectMaterialHUDWindow), @"popover": @(NSVisualEffectMaterialPopover) };
  NSVisualEffectView *view = objc_getAssociatedObject(window, &MaterialKey);
  NSNumber *material = materials[name];
  if (!material) { [view removeFromSuperview]; objc_setAssociatedObject(window, &MaterialKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC); return; }
  if (!view) {
    view = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    view.blendingMode = NSVisualEffectBlendingModeBehindWindow; view.state = NSVisualEffectStateFollowsWindowActiveState;
    objc_setAssociatedObject(window, &MaterialKey, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  // Below the React surface, so transparent React content shows the material.
  if (view.superview != window.contentView) { view.frame = window.contentView.bounds; [window.contentView addSubview:view positioned:NSWindowBelow relativeTo:nil]; }
  view.material = (NSVisualEffectMaterial)material.integerValue;
}
// macos.cornerSnapping (picture in picture): every move (windowDidMove:, and setWindowBounds) ends at the nearest
// corner of the owning display's work area, inset by the margin. A move the user drags snaps when the mouse button comes up: AppKit reports the
// moves of a drag as they happen, so a one-shot mouse-up monitor (local, and global for a server-side title-bar
// drag) waits for the release. Main thread only. The snap object belongs to the window (associated object);
// its blocks hold it and the window weakly, and it removes its monitors when the window releases it.
@interface SparkCornerSnap : NSObject
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic) CGFloat margin;
@property (nonatomic) BOOL snapping;
@property (nonatomic) id localMonitor, globalMonitor;
@end
@implementation SparkCornerSnap
- (void)stopWaiting {
  if (self.localMonitor) [NSEvent removeMonitor:self.localMonitor];
  if (self.globalMonitor) [NSEvent removeMonitor:self.globalMonitor];
  self.localMonitor = nil; self.globalMonitor = nil;
}
- (void)waitForMouseUp {
  if (self.localMonitor) return;
  __weak SparkCornerSnap *weak = self;
  void (^released)(void) = ^{ dispatch_async(dispatch_get_main_queue(), ^{ SparkCornerSnap *snap = weak; [snap stopWaiting]; if (snap.window) SnapToCorner(snap.window); }); };
  self.localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseUp handler:^NSEvent *(NSEvent *event) { released(); return event; }];
  self.globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseUp handler:^(NSEvent *event) { released(); }];
}
- (void)dealloc { [self stopWaiting]; }
@end
// The nearest corner of the owning display's work area, inset by `margin`.
static NSRect CornerFrame(NSRect frame, CGFloat margin) {
  NSRect area = SparkOwning(frame).visibleFrame;
  frame.origin.x = NSMidX(frame) < NSMidX(area) ? NSMinX(area) + margin : NSMaxX(area) - margin - NSWidth(frame);
  frame.origin.y = NSMidY(frame) < NSMidY(area) ? NSMinY(area) + margin : NSMaxY(area) - margin - NSHeight(frame);
  return frame;
}
static void SnapToCorner(NSWindow *window) {
  SparkCornerSnap *snap = objc_getAssociatedObject(window, &CornerSnapKey);
  if (!snap || snap.snapping) return;
  // The driver's pointer never presses the real mouse button, and a person's button must not decide a driven run.
  if (!SparkTestDriverActive() && (NSEvent.pressedMouseButtons & 1)) { [snap waitForMouseUp]; return; }
  NSRect target = CornerFrame(window.frame, snap.margin);
  if (NSEqualRects(target, window.frame)) return;
  // AppKit animates a frame only on screen (driver mode never is): elsewhere the window moves at once.
  if (!window.visible) { snap.snapping = YES; [window setFrame:target display:NO]; snap.snapping = NO; return; }
  snap.snapping = YES;
  __weak SparkCornerSnap *weak = snap;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) { context.duration = 0.2; [[window animator] setFrame:target display:YES]; }
    completionHandler:^{ weak.snapping = NO; }];
}
static void SetCornerSnapping(NSWindow *window, id options) {
  if (options == NSNull.null) { objc_setAssociatedObject(window, &CornerSnapKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC); return; }
  SparkCornerSnap *snap = objc_getAssociatedObject(window, &CornerSnapKey);
  if (!snap) { snap = [SparkCornerSnap new]; snap.window = window; objc_setAssociatedObject(window, &CornerSnapKey, snap, OBJC_ASSOCIATION_RETAIN_NONATOMIC); }
  // From the next move on: opening places the window after the options apply.
  snap.margin = [options[@"margin"] doubleValue];
}
static NSInteger SimpleFullscreenWindows;
static NSApplicationPresentationOptions PresentationBeforeSimpleFullscreen;
// Pre-Lion fullscreen: the window covers its screen in the current Space. Frame autosave and
// restoreBounds keep the windowed frame; chrome hidden here is restored on exit.
static void SetSimpleFullscreen(NSWindow *window, BOOL enabled) {
  NSDictionary *saved = objc_getAssociatedObject(window, &SimpleFullscreenKey);
  if (enabled == (saved != nil)) return;
  const NSWindowStyleMask bits = NSWindowStyleMaskFullSizeContentView | NSWindowStyleMaskResizable;
  if (enabled) {
    NSMutableArray *hidden = [NSMutableArray new];
    for (NSWindowButton kind : TrafficLights) [hidden addObject:@([window standardWindowButton:kind].hidden)];
    objc_setAssociatedObject(window, &SimpleFullscreenKey, @{ @"frame": [NSValue valueWithRect:window.frame], @"mask": @(window.styleMask & bits), @"transparent": @(window.titlebarAppearsTransparent),
      @"titleVisibility": @(window.titleVisibility), @"movable": @(window.movable), @"buttons": hidden, @"toolbar": @(window.toolbar.visible), @"autosave": window.frameAutosaveName ?: @"" }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (SimpleFullscreenWindows++ == 0) { PresentationBeforeSimpleFullscreen = NSApp.presentationOptions; NSApp.presentationOptions = NSApplicationPresentationAutoHideDock | NSApplicationPresentationAutoHideMenuBar; }
    [window setFrameAutosaveName:@""];
    window.styleMask = (window.styleMask | NSWindowStyleMaskFullSizeContentView) & ~NSWindowStyleMaskResizable;
    window.titlebarAppearsTransparent = YES; window.titleVisibility = NSWindowTitleHidden; window.movable = NO; window.toolbar.visible = NO;
    for (NSWindowButton kind : TrafficLights) [window standardWindowButton:kind].hidden = YES;
    [window setFrame:(window.screen ?: NSScreen.mainScreen).frame display:YES];
    return;
  }
  objc_setAssociatedObject(window, &SimpleFullscreenKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.styleMask = (window.styleMask & ~bits) | [saved[@"mask"] unsignedIntegerValue];
  window.titlebarAppearsTransparent = [saved[@"transparent"] boolValue]; window.titleVisibility = (NSWindowTitleVisibility)[saved[@"titleVisibility"] integerValue];
  window.movable = [saved[@"movable"] boolValue]; window.toolbar.visible = [saved[@"toolbar"] boolValue];
  for (int index = 0; index < 3; index++) [window standardWindowButton:TrafficLights[index]].hidden = [saved[@"buttons"][index] boolValue];
  [window setFrame:[saved[@"frame"] rectValue] display:YES];
  if ([saved[@"autosave"] length]) [window setFrameAutosaveName:saved[@"autosave"]];
  if (--SimpleFullscreenWindows == 0) NSApp.presentationOptions = PresentationBeforeSimpleFullscreen;
}
// restoreBounds: a window rejoins the first open window of its saved tab group, after the saved
// tabs that preceded it. AppKit removes hidden windows from tab groups, so this waits for presentation.
static BOOL JoinSavedTabs(NSWindow *window, NSString *key, NSArray *saved) {
  NSUInteger position = [saved indexOfObject:key];
  if (position == NSNotFound || window.tabbingMode == NSWindowTabbingModeDisallowed) return NO;
  for (NSString *peerKey in saved) {
    NSWindow *peer = [peerKey isKindOfClass:NSString.class] && ![peerKey isEqual:key] ? Window(peerKey) : nil;
    if (![peer isKindOfClass:NSWindow.class] || !Visible(peer) || peer.tabbingMode == NSWindowTabbingModeDisallowed || ![peer.tabbingIdentifier isEqual:window.tabbingIdentifier]) continue;
    NSArray<NSWindow *> *tabs = TabWindows(peer);
    NSUInteger index = 0;
    for (NSUInteger tab = 0; tab < tabs.count; tab++) {
      NSUInteger order = [saved indexOfObject:KeyFor(tabs[tab]) ?: @""];
      if (order != NSNotFound && order < position) index = tab + 1;
    }
    [peer.tabGroup insertWindow:window atIndex:index];
    return YES;
  }
  return NO;
}
// Shows the window, first rejoining a saved tab group. A restored tab is selected only if it was
// selected when saved; otherwise the group keeps its selection.
static void Present(NSWindow *window, SparkWindowDelegate *delegate, BOOL focus, NSWindow *sheetParent) {
  NSDictionary *restoring = delegate.restoringTabs; delegate.restoringTabs = nil;
  BOOL joined = restoring && JoinSavedTabs(window, delegate.windowID, restoring[@"tabs"]);
  NSNumber *selected = restoring[@"selected"];
  NSWindow *selection = joined && !([selected isKindOfClass:NSNumber.class] && selected.boolValue) ? SelectedTab(window) : window;
  Show(window, focus, sheetParent);
  if (joined) SelectTab(selection);
}
static BOOL ApplyCommon(NSWindow *window, NSDictionary *options, RCTPromiseRejectBlock reject) {
  NSDictionary *macos = options[@"macos"], *titleBar = macos[@"titleBar"];
  if (InSimpleFullscreen(window) && (options[@"titleBarStyle"] || options[@"resizable"] || options[@"minSize"] || options[@"maxSize"] || titleBar.count > (titleBar[@"subtitle"] ? 1 : 0))) {
    reject(@"E_BUSY", @"Leave simple fullscreen before changing the title bar, resizability or size constraints", nil); return NO;
  }
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
  if (mask != window.styleMask) window.styleMask = mask;
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
  if (options[@"aspectRatio"]) {
    // AppKit keeps one of the two: resize increments of 1 clear the content aspect ratio.
    if (options[@"aspectRatio"] == NSNull.null) window.contentResizeIncrements = NSMakeSize(1, 1);
    else window.contentAspectRatio = NSMakeSize([options[@"aspectRatio"] doubleValue], 1);
  }
  if (options[@"opacity"]) window.alphaValue = [options[@"opacity"] doubleValue];
  if (options[@"contentProtection"]) window.sharingType = [options[@"contentProtection"] boolValue] ? NSWindowSharingNone : NSWindowSharingReadOnly;
  if (options[@"ignoreMouseEvents"]) window.ignoresMouseEvents = [options[@"ignoreMouseEvents"] boolValue];
  if (macos[@"spaces"]) {
    NSString *spaces = macos[@"spaces"];
    window.collectionBehavior = (window.collectionBehavior & ~(NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorMoveToActiveSpace))
      | ([spaces isEqual:@"all"] ? NSWindowCollectionBehaviorCanJoinAllSpaces : [spaces isEqual:@"active"] ? NSWindowCollectionBehaviorMoveToActiveSpace : 0);
  }
  // Collection behaviors for special windows (docs/api-window-contract.md#special-window-types). AppKit rejects a
  // window that is both a fullscreen primary and auxiliary window, so auxiliary clears primary.
  if (macos[@"fullScreenAuxiliary"]) {
    NSWindowCollectionBehavior behavior = window.collectionBehavior & ~(NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorFullScreenPrimary);
    window.collectionBehavior = [macos[@"fullScreenAuxiliary"] boolValue] ? behavior | NSWindowCollectionBehaviorFullScreenAuxiliary : behavior;
  }
  if (macos[@"stationary"]) window.collectionBehavior = [macos[@"stationary"] boolValue] ? window.collectionBehavior | NSWindowCollectionBehaviorStationary : window.collectionBehavior & ~NSWindowCollectionBehaviorStationary;
  if (macos[@"ignoresCycle"]) window.collectionBehavior = [macos[@"ignoresCycle"] boolValue] ? (window.collectionBehavior | NSWindowCollectionBehaviorIgnoresCycle) & ~NSWindowCollectionBehaviorParticipatesInCycle : window.collectionBehavior & ~NSWindowCollectionBehaviorIgnoresCycle;
  if (macos[@"cornerSnapping"]) SetCornerSnapping(window, macos[@"cornerSnapping"]);
  NSDictionary *tabbing = options[@"tabbing"];
  if (tabbing[@"mode"]) window.tabbingMode = [tabbing[@"mode"] isEqual:@"preferred"] ? NSWindowTabbingModePreferred : [tabbing[@"mode"] isEqual:@"disallowed"] ? NSWindowTabbingModeDisallowed : NSWindowTabbingModeAutomatic;
  if (tabbing[@"identifier"]) window.tabbingIdentifier = tabbing[@"identifier"];
  if (macos[@"documentEdited"]) window.documentEdited = [macos[@"documentEdited"] boolValue];
  if (macos[@"backgroundMaterial"]) SetBackgroundMaterial(window, macos[@"backgroundMaterial"]);
  if (titleBar[@"subtitle"]) window.subtitle = titleBar[@"subtitle"];
  if (titleBar[@"trafficLightPosition"]) SetTrafficLightPosition(window, titleBar[@"trafficLightPosition"]);
  else [objc_getAssociatedObject(window, &TrafficLightKey) layout];
  if (options[@"minSize"] || options[@"maxSize"]) {
    window.minSize = minimum; window.maxSize = maximum;
    NSRect frame = window.frame;
    frame.size.width = MIN(MAX(frame.size.width, minimum.width), maximum.width);
    frame.size.height = MIN(MAX(frame.size.height, minimum.height), maximum.height);
    if (!NSEqualRects(frame, window.frame)) [window setFrame:frame display:YES];
  }
  return YES;
}
static BOOL SetBounds(NSWindow *window, NSDictionary *bounds, double durationMs, RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject) {
  SparkScreen *screen = SparkScreenForId(bounds[@"displayId"]);
  if (!screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return NO; }
  NSRect frame = SparkAppKitFrame(bounds, screen.frame);
  if (frame.size.width < window.minSize.width || frame.size.height < window.minSize.height || frame.size.width > window.maxSize.width || frame.size.height > window.maxSize.height) { reject(@"E_INVALID_ARGUMENT", @"Bounds are outside window constraints", nil); return NO; }
  // AppKit reports moves of a window that is not on screen late or not at all, so a commanded move snaps here.
  // AppKit animates a frame only on screen (driver mode never is): elsewhere the window moves at once.
  if (durationMs > 0 && window.visible) [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) { context.duration = durationMs / 1000.0; [[window animator] setFrame:frame display:YES]; } completionHandler:^{ resolve(@"null"); SnapToCorner(window); }];
  else { [window setFrame:frame display:YES]; resolve(@"null"); SnapToCorner(window); }
  return YES;
}
// One sequence for every runtime, so a listener can drop events older than its snapshot. Not /system's
// "displaysChanged" (onSystemEvent), which carries no payload: the two streams stay separate.
static double DisplaySequence;
static void EmitDisplays(void) { SparkEmit(@{ @"type": @"displayDetailsChanged", @"sequence": @(++DisplaySequence), @"displays": SparkDisplayDetails() }); }
#if SPARK_TEST_DRIVER
// The in-app test driver's display source (docs/displays.md#simulated-displays). Reachable only through an
// authenticated driver session: {"command": "simulateDisplays", "displays": [DisplayDetails, ...] | null}.
@interface SparkDisplaysDriver : NSObject
@end
@implementation SparkDisplaysDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateDisplays", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id displays = request[@"displays"];
    if (displays != NSNull.null && !SparkValidSimulatedDisplays(displays)) { reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_INVALID_ARGUMENT", @"message": @"simulateDisplays expects displays with unique IDs, exactly one primary, an origin, size, work area and scale factor; or null" } }); return; }
    SparkSimulateDisplays(displays == NSNull.null ? nil : displays);
    // Motion's frame rate follows the simulated primary display's refresh rate (docs/motion.md#frame-rate-and-power).
    id primary = nil;
    for (NSDictionary *display in displays == NSNull.null ? @[] : displays) if ([display[@"primary"] isEqual:@YES]) primary = display;
    id maximum = [primary[@"refreshRate"] isKindOfClass:NSDictionary.class] ? primary[@"refreshRate"][@"maximum"] : nil;
    SparkTestDriverDidSimulateState(@{ @"maximumFramesPerSecond": [maximum isKindOfClass:NSNumber.class] ? maximum : NSNull.null });
    reply(@{ @"ok": @YES, @"displays": SparkDisplayDetails() });
  });
}
@end
#endif
@interface RNDesktopWindows ()
@property SparkDisplayObserver *displayObserver;
@property NSUInteger displayObservers;
@end
@implementation RNDesktopWindows
RCT_EXPORT_MODULE(NativeDesktopWindowManager)
- (instancetype)init {
  if ((self = [super init])) {
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationVisibilityChanged:) name:NSApplicationDidHideNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationVisibilityChanged:) name:NSApplicationDidUnhideNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(applicationWillTerminate:) name:NSApplicationWillTerminateNotification object:nil];
  }
  return self;
}
- (void)applicationWillTerminate:(NSNotification *)notification { Terminating = YES; }
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
    if ([method isEqual:@"displays"]) { resolve(SparkJSON(SparkWindowDisplays())); return; }
    if ([method isEqual:@"displayDetails"]) { resolve(SparkJSON(SparkDisplayDetails())); return; }
    // Observation runs only while a listener in this runtime holds it.
    if ([method isEqual:@"observeDisplays"]) {
      if (self.displayObservers++ == 0) self.displayObserver = [[SparkDisplayObserver alloc] initWithHandler:^{ EmitDisplays(); }];
      resolve(SparkJSON(@{ @"sequence": @(DisplaySequence), @"displays": SparkDisplayDetails() })); return;
    }
    if ([method isEqual:@"unobserveDisplays"]) {
      if (self.displayObservers && --self.displayObservers == 0) { [self.displayObserver stop]; self.displayObserver = nil; }
      resolve(@"null"); return;
    }
    // The process's physical footprint (what Activity Monitor shows), for window pool memory budgets.
    if ([method isEqual:@"footprint"]) {
      task_vm_info_data_t info; mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
      if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) { reject(@"E_NATIVE", @"task_info failed", nil); return; }
      resolve(SparkJSON(@{ @"bytes": @(info.phys_footprint) })); return;
    }
    if ([method isEqual:@"cursorPoint"]) {
      resolve(SparkJSON(SparkPointer()));
      return;
    }
    if ([method isEqual:@"list"]) {
      NSMutableArray *result = [NSMutableArray new];
      for (NSString *windowID in windows) [result addObject:Info(windowID, windows[windowID])];
      resolve(SparkJSON(result)); return;
    }
    if ([method isEqual:@"tabGroups"]) {
      NSMutableArray *result = [NSMutableArray new]; NSMutableSet *listed = [NSMutableSet new];
      for (NSString *windowID in windows) {
        if (![windows[windowID] isKindOfClass:NSWindow.class] || [listed containsObject:windowID]) continue;
        NSDictionary *group = TabGroup(windows[windowID]);
        [listed addObjectsFromArray:group[@"windowIds"]]; [result addObject:group];
      }
      resolve(SparkJSON(result)); return;
    }
    NSWindow *window = Window(key);
    if (!window) { reject(@"E_NOT_FOUND", @"Window does not exist", nil); return; }
    InstallDelegate(window, key);
    SparkWindowDelegate *delegate = delegates[key];
    if (args[@"instanceId"] && ![args[@"instanceId"] isEqual:delegate.instanceId]) { reject(@"E_NOT_FOUND", @"Window instance has closed", nil); return; }
    if ([method isEqual:@"info"] || [method isEqual:@"observe"]) { resolve(SparkJSON(Info(key, window))); return; }
    if ([method isEqual:@"tabGroup"]) { resolve(SparkJSON(TabGroup(window))); return; }
    // Window pools: park on close instead of closing, and hand a warm window's React root its next props.
    if ([method isEqual:@"pool"]) { delegate.parkOnClose = [args[@"enabled"] boolValue]; resolve(@"null"); return; }
    if ([method isEqual:@"rootProps"]) {
      RCTRootView *root = LegendWindowRegistry.sharedRegistry.rootViews[key];
      if (![root respondsToSelector:@selector(setAppProperties:)] || ![args[@"props"] isKindOfClass:NSDictionary.class]) { reject(@"E_NOT_FOUND", @"Window has no React root", nil); return; }
      root.appProperties = args[@"props"]; resolve(@"null"); return;
    }
    if (InSimpleFullscreen(window) && [@[@"bounds", @"fullscreen", @"maximize", @"unmaximize", @"center"] containsObject:method]) { reject(@"E_BUSY", @"Leave simple fullscreen first", nil); return; }
    if ([method isEqual:@"completeOpen"]) {
      NSWindow *parent = args[@"parentId"] ? Window(args[@"parentId"]) : nil;
      if (args[@"parentId"] && !parent) { reject(@"E_NOT_FOUND", @"Parent window not found", nil); return; }
      if ([args[@"modal"] boolValue] && parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
      NSWindow *tabTarget = args[@"tabbedWith"] ? Window(args[@"tabbedWith"]) : nil;
      if (args[@"tabbedWith"]) {
        NSString *mode = args[@"tabbing"][@"mode"], *identifier = args[@"tabbing"][@"identifier"];
        if (![tabTarget isKindOfClass:NSWindow.class] || tabTarget == window) { reject(@"E_NOT_FOUND", @"The window to open a tab next to was not found", nil); return; }
        // AppKit keeps only shown windows in tab groups.
        if (!(SparkTestDriverActive() ? SparkDriverShown(tabTarget) : tabTarget.visible)) { reject(@"E_INVALID_ARGUMENT", @"The window to open a tab next to is hidden", nil); return; }
        if (tabTarget.tabbingMode == NSWindowTabbingModeDisallowed || [mode isEqual:@"disallowed"] || (!mode && window.tabbingMode == NSWindowTabbingModeDisallowed)) { reject(@"E_INVALID_ARGUMENT", @"Tabbing is disallowed for this window or the window it joins", nil); return; }
        if (identifier && ![identifier isEqual:tabTarget.tabbingIdentifier]) { reject(@"E_INVALID_ARGUMENT", @"A tab must share the tabbing identifier of the window it joins", nil); return; }
      }
      window.minSize = NSMakeSize(100, 100); window.maxSize = NSMakeSize(20000, 20000);
      if (!ApplyCommon(window, args, reject)) return;
      // Driver mode neither reads nor saves bounds: every driven launch opens windows at their configured size.
      BOOL restoreBounds = [args[@"restoreBounds"] boolValue] && !SparkTestDriverActive();
      NSDictionary *saved = restoreBounds ? [NSUserDefaults.standardUserDefaults dictionaryForKey:[NSString stringWithFormat:@"%@.bounds.%@", SparkNamespace(), key]] : nil;
      if (![saved[@"version"] isEqual:@1]) saved = nil;
      BOOL restoredShell = [objc_getAssociatedObject(window, NSSelectorFromString(@"sparkRestoredShell")) boolValue];
      if (!saved && restoredShell) {
        SparkScreen *restoredScreen = SparkOwning(window.frame);
        saved = @{ @"bounds": SparkLogicalBounds(window.frame, restoredScreen.frame, restoredScreen.identifier), @"persistentId": restoredScreen.persistentId ?: @"" };
      }
      SparkScreen *screen = args[@"position"] ? SparkScreenForId(args[@"position"][@"displayId"]) : nil;
      if (args[@"position"] && !screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return; }
      if (!screen && saved) for (SparkScreen *candidate in SparkScreens()) if ([candidate.persistentId isEqual:saved[@"persistentId"]]) { screen = candidate; break; }
      if (!screen) screen = parent ? SparkOwning(parent.frame) : SparkPrimary();
      NSDictionary *size = args[@"size"] ?: saved[@"bounds"];
      CGFloat width = size ? [size[@"width"] doubleValue] : 640, height = size ? [size[@"height"] doubleValue] : 480;
      width = MIN(MAX(width, window.minSize.width), window.maxSize.width); height = MIN(MAX(height, window.minSize.height), window.maxSize.height);
      NSRect frame = NSMakeRect(NSMidX(screen.visibleFrame) - width / 2, NSMidY(screen.visibleFrame) - height / 2, width, height);
      if (args[@"position"] || saved) {
        NSMutableDictionary *bounds = [(args[@"position"] ?: saved[@"bounds"]) mutableCopy]; bounds[@"width"] = @(width); bounds[@"height"] = @(height);
        frame = SparkAppKitFrame(bounds, screen.frame);
        if (!args[@"position"] && screen.screen) frame = [window constrainFrameRect:frame toScreen:screen.screen];
      }
      [window setFrame:frame display:NO]; delegate.restoreBounds = restoreBounds;
      if (parent && ![args[@"modal"] boolValue]) [parent addChildWindow:window ordered:NSWindowAbove];
      objc_setAssociatedObject(window, @selector(call:args:resolve:reject:), [args copy], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      // A new tab is the group's last tab, with its frame and tabbing identifier, and is selected once shown.
      // AppKit keeps a window added before it is first shown (tests/window.native.mm, TestShownTabs).
      if (tabTarget) { window.tabbingIdentifier = tabTarget.tabbingIdentifier; [tabTarget.tabGroup addWindow:window]; }
      delegate.restoringTabs = restoreBounds && !tabTarget && [saved[@"tabs"] isKindOfClass:NSArray.class] ? saved : nil;
      if (![args[@"show"] isEqual:@NO]) Present(window, delegate, YES, [args[@"modal"] boolValue] ? parent : nil); else Hide(window);
      if (tabTarget) SelectTab(window);
      Event(@"opened", key); Event(@"visibilityChanged", key); resolve(SparkJSON(Info(key, window))); return;
    }
    if ([method isEqual:@"discard"]) { delegate.guarded = NO; if (SparkTestDriverActive()) DetachTab(window); [window close]; return resolve(@"null"); }
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
      if (window.miniaturized) [window deminiaturize:nil];
      NSDictionary *opening = objc_getAssociatedObject(window, @selector(call:args:resolve:reject:));
      if ([opening[@"modal"] boolValue] && !window.sheetParent) {
        NSWindow *parent = Window(opening[@"parentId"]);
        if (!parent) { reject(@"E_NOT_FOUND", @"Parent window has closed", nil); return; }
        if (parent.attachedSheet) { reject(@"E_BUSY", @"Parent already has a sheet", nil); return; }
        Present(window, delegate, YES, parent);
      } else Present(window, delegate, ![args[@"focus"] isEqual:@NO], nil);
      Event(@"visibilityChanged", key);
    } else if ([method isEqual:@"selectTab"]) {
      if (TabWindows(window).count > 1) SelectTab(window);
      ScheduleTabs();
    } else if ([method isEqual:@"moveTabToNewWindow"]) {
      if (TabWindows(window).count > 1) {
        // AppKit's action also orders the new window on screen, which driver mode never does.
        if (SparkTestDriverActive()) DetachTab(window); else [window moveTabToNewWindow:nil];
        if (TabWindows(window).count > 1) { reject(@"E_NATIVE", @"The tab did not move to a new window", nil); return; }
      }
      ScheduleTabs();
    } else if ([method isEqual:@"mergeAllWindows"]) {
      if (window.tabbingMode == NSWindowTabbingModeDisallowed) { reject(@"E_INVALID_ARGUMENT", @"Tabbing is disallowed for this window", nil); return; }
      if (SparkTestDriverActive()) MergeShownWindows(window); else [window mergeAllWindows:nil];
      ScheduleTabs();
    } else if ([method isEqual:@"tabBar"]) {
      BOOL visible = [args[@"visible"] boolValue];
      if (window.tabbingMode == NSWindowTabbingModeDisallowed) { reject(@"E_INVALID_ARGUMENT", @"Tabbing is disallowed for this window", nil); return; }
      if (!visible && TabWindows(window).count > 1) { reject(@"E_BUSY", @"The tab bar stays visible while the group has more than one tab", nil); return; }
      if (window.tabGroup.tabBarVisible != visible) [window toggleTabBar:nil];
      if (window.tabGroup.tabBarVisible != visible) { reject(@"E_NATIVE", @"The tab bar did not change", nil); return; }
      ScheduleTabs();
    } else if ([method isEqual:@"newTab"]) {
      BOOL enable = [args[@"enabled"] boolValue];
      if (enable && delegate.tabHandlerId && ![delegate.tabHandlerId isEqual:args[@"handlerId"]]) { reject(@"E_BUSY", @"Window already has a new-tab handler", nil); return; }
      if (!enable && ![delegate.tabHandlerId isEqual:args[@"handlerId"]]) return resolve(@"null");
      delegate.tabHandlerId = enable ? args[@"handlerId"] : nil;
    } else if ([method isEqual:@"options"]) {
      NSNumber *simpleFullscreen = args[@"options"][@"macos"][@"simpleFullscreen"];
      if (simpleFullscreen.boolValue && (window.styleMask & NSWindowStyleMaskFullScreen)) { reject(@"E_BUSY", @"The window is in native fullscreen", nil); return; }
      if (!ApplyCommon(window, args[@"options"], reject)) return;
      if (simpleFullscreen) SetSimpleFullscreen(window, simpleFullscreen.boolValue);
    }
    else if ([method isEqual:@"maximize"]) { if (!window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"unmaximize"]) { if (window.zoomed) [window zoom:nil]; }
    else if ([method isEqual:@"center"]) {
      SparkScreen *screen = args[@"displayId"] ? SparkScreenForId(args[@"displayId"]) : SparkOwning(window.frame);
      if (!screen) { reject(@"E_NOT_FOUND", @"Display is disconnected", nil); return; }
      NSRect frame = window.frame; frame.origin = NSMakePoint(NSMidX(screen.visibleFrame) - NSWidth(frame)/2, NSMidY(screen.visibleFrame) - NSHeight(frame)/2); [window setFrame:frame display:YES];
    } else if ([method isEqual:@"hide"]) {
      Hide(window); Event(@"visibilityChanged", key);
    } else if ([method isEqual:@"minimize"]) [window miniaturize:nil];
    else if ([method isEqual:@"fullscreen"]) {
      BOOL target = [args[@"enabled"] boolValue];
      if (SparkTestDriverActive() && target != ((window.styleMask & NSWindowStyleMaskFullScreen) != 0)) { reject(@"E_UNSUPPORTED_OPTION", @"Native fullscreen needs an on-screen window; test driver mode never shows windows", nil); return; }
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
      delegate.tabHandlerId = nil;
    }
    [self.displayObserver stop]; self.displayObserver = nil; self.displayObservers = 0;
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopWindowManagerSpecJSI>(params);
}
@end
