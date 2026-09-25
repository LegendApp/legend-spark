#import "AppDelegate.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTUIKit.h>
#import <QuartzCore/QuartzCore.h>
#include <cxxreact/ReactMarker.h>
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

#if __has_include(<NativeComposeThreadedRuntime/ThreadedRuntime.h>)
#import <NativeComposeThreadedRuntime/ThreadedRuntime.h>
#import <React/RCTReloadCommand.h>
#endif

@interface AppDelegate () <NSWindowDelegate>
@property (nonatomic, assign) BOOL sparkPrimaryInstance;
@property (nonatomic, weak) NSWindow *sparkLastFocusedWindow;
@property (nonatomic, strong) NSColor *sparkStartupColor;
@end

@implementation AppDelegate
- (void)applicationWillFinishLaunching:(NSNotification *)notification {
  self.sparkPrimaryInstance = SparkAcquireInstance();
  if (!self.sparkPrimaryInstance) { [NSApp terminate:nil]; return; }
  facebook::react::ReactMarker::logMarkerDone(facebook::react::ReactMarker::APP_STARTUP_START, CACurrentMediaTime() * 1000);
  [self sparkPrepareMainMenu];
  SparkPrepareApplication();
  [self sparkPrepareMainWindow];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(sparkWindowDidBecomeKey:)
    name:NSWindowDidBecomeKeyNotification object:nil];
}
- (void)sparkPrepareMainMenu {
  NSString *name = SparkContext()[@"name"];
  NSMenuItem *applicationItem = NSApp.mainMenu.itemArray.firstObject;
  applicationItem.title = name;
  NSMenu *menu = applicationItem.submenu;
  menu.title = name;
  for (NSMenuItem *item in menu.itemArray) {
    if (item.isAlternate) continue;
    if (item.action == @selector(orderFrontStandardAboutPanel:)) item.title = [@"About " stringByAppendingString:name];
    else if (item.action == @selector(hide:)) item.title = [@"Hide " stringByAppendingString:name];
    else if (item.action == @selector(terminate:)) item.title = [@"Quit " stringByAppendingString:name];
  }
  for (NSMenuItem *item in NSApp.helpMenu.itemArray)
    if (item.action == @selector(showHelp:)) item.title = [name stringByAppendingString:@" Help"];
}
- (void)sparkWindowDidBecomeKey:(NSNotification *)note {
  NSWindow *window = note.object;
  if (window != self.window && ![window isKindOfClass:NSPanel.class] && !window.sheet) self.sparkLastFocusedWindow = window;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  if (!self.sparkPrimaryInstance) return;
  SparkMarkLaunchComplete();
  self.moduleName = @"main";
  self.dependencyProvider = [RCTAppDependencyProvider new];
  self.initialProps = SparkInitialProps(@"main", self.initialProps ?: @{});
#if __has_include(<NativeComposeThreadedRuntime/ThreadedRuntime.h>)
  [ThreadedRuntime configureWithReactNativeDelegate:self launchOptions:@{}];
  // Fired before React Native enumerates reload listeners, so workers are
  // discarded before the main app restarts. Worker invalidation owns no app UI.
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(sparkResetRuntimes:)
    name:RCTTriggerReloadCommandNotification object:nil];
#endif
  facebook::react::ReactMarker::logMarkerDone(facebook::react::ReactMarker::INIT_REACT_RUNTIME_START, CACurrentMediaTime() * 1000);
  [super applicationDidFinishLaunching:notification];
}
#if __has_include(<NativeComposeThreadedRuntime/ThreadedRuntime.h>)
- (void)sparkResetRuntimes:(NSNotification *)notification { [ThreadedRuntime destroyAllRuntimes]; }
- (void)applicationWillTerminate:(NSNotification *)notification { [ThreadedRuntime destroyAllRuntimes]; }
#endif
- (void)sparkPrepareMainWindow {
  if (self.window) return;
  NSDictionary *policy = SparkLifecycleConfiguration()[@"mainWindow"] ?: @{};
  NSDictionary *options = SparkWindowConfiguration();
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 700)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
    backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.identifier = @"spark.main";
  self.window.title = SparkContext()[@"name"];
  self.window.delegate = self;
  SparkApplyWindowOptions(self.window, options);
  SparkRestoreWindow(self.window, @"main", options);
  NSString *autosave = policy[@"autosaveName"];
  if (autosave.length) { [self.window setFrameAutosaveName:autosave]; [self.window setFrameUsingName:autosave]; }
  if (policy[@"toolbarStyle"]) {
    self.window.toolbar = [[NSToolbar alloc] initWithIdentifier:@"main"];
    self.window.toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    self.window.toolbar.showsBaselineSeparator = NO;
    self.window.toolbarStyle = [policy[@"toolbarStyle"] isEqual:@"unified"] ? NSWindowToolbarStyleUnified : NSWindowToolbarStyleExpanded;
  }
  NSDictionary *separators = @{ @"automatic": @(NSTitlebarSeparatorStyleAutomatic), @"none": @(NSTitlebarSeparatorStyleNone), @"line": @(NSTitlebarSeparatorStyleLine), @"shadow": @(NSTitlebarSeparatorStyleShadow) };
  if (policy[@"titlebarSeparatorStyle"]) self.window.titlebarSeparatorStyle = (NSTitlebarSeparatorStyle)[separators[policy[@"titlebarSeparatorStyle"]] integerValue];
  NSDictionary *colors = policy[@"backgroundColors"];
  if (colors && ![options[@"transparent"] boolValue]) {
    NSString *appearance = options[@"appearance"];
    BOOL dark = [appearance isEqual:@"dark"] || (![appearance isEqual:@"light"] && [[[NSUserDefaults.standardUserDefaults stringForKey:@"AppleInterfaceStyle"] lowercaseString] isEqualToString:@"dark"]);
    SparkApplyWindowOptions(self.window, @{ @"backgroundColor": colors[dark ? @"dark" : @"light"] });
  }
  self.sparkStartupColor = self.window.backgroundColor;
  NSView *placeholder = [[NSView alloc] initWithFrame:self.window.contentView.bounds];
  placeholder.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  placeholder.wantsLayer = YES; placeholder.layer.backgroundColor = self.sparkStartupColor.CGColor;
  self.window.contentView = placeholder;
  SparkPrepareMainWindow(self.window);
  if (![policy[@"hidden"] boolValue] && ![[NSBundle.mainBundle objectForInfoDictionaryKey:@"SparkMenuBarOnly"] boolValue]) {
    [self.window makeKeyAndOrderFront:nil]; [self.window displayIfNeeded]; SparkRecordMainWindowShown();
  }
}
- (void)loadReactNativeWindow:(NSDictionary *)launchOptions {
  [self sparkPrepareMainWindow];
  NSView *root = [self.rootViewFactory viewWithModuleName:self.moduleName initialProperties:self.initialProps launchOptions:launchOptions];
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  NSDictionary *options = SparkWindowConfiguration();
  if ([options[@"transparent"] boolValue] || options[@"backgroundColor"] || SparkLifecycleConfiguration()[@"mainWindow"][@"backgroundColors"])
    ((RCTUIView *)root).backgroundColor = self.sparkStartupColor;
  __weak NSWindow *weakWindow = self.window;
  SparkAttachMainRootView(root, self.window, ^{
    NSWindow *window = weakWindow;
    if (!window) return;
    root.frame = window.contentView.bounds;
    if ([SparkLifecycleConfiguration()[@"mainWindow"][@"glass"] boolValue]) {
      if (@available(macOS 26.0, *)) {
        NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:root.frame];
        glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        glass.contentView = root; window.contentView = glass;
      } else window.contentView = root;
    } else {
      window.contentView = SparkWindowContent(root);
      // An empty patch styles the newly attached content without overwriting
      // restored window dimensions with the configured initial width/height.
      SparkApplyWindowOptions(window, @{});
    }
  });
}
- (BOOL)windowShouldClose:(NSWindow *)window {
  NSString *behavior = SparkLifecycleConfiguration()[@"mainWindow"][@"closeBehavior"];
  if ([behavior isEqual:@"hide"]) { [window orderOut:nil]; return NO; }
  if ([behavior isEqual:@"request"]) { SparkEmit(@{ @"type": @"closeRequested", @"windowId": @"main" }); return NO; }
  return YES;
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return SparkShouldQuit(); }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }
- (void)applicationDidBecomeActive:(NSNotification *)note { SparkEmit(@{ @"type": @"activate" }); }
- (void)applicationDidResignActive:(NSNotification *)note { SparkEmit(@{ @"type": @"deactivate" }); }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  NSDictionary *policy = SparkLifecycleConfiguration()[@"mainWindow"] ?: @{};
  BOOL manual = [policy[@"reopenBehavior"] isEqual:@"manual"];
  BOOL hidden = [policy[@"hidden"] boolValue] || [[NSBundle.mainBundle objectForInfoDictionaryKey:@"SparkMenuBarOnly"] boolValue];
  BOOL hadVisibleMainWindow = self.window.isVisible;
  if (!manual) {
    BOOL visibleOnly = hidden || [policy[@"reopenBehavior"] isEqual:@"visibleWindows"];
    NSWindow *target = visibleOnly ? nil : self.window;
    if (visibleOnly) {
      if (self.sparkLastFocusedWindow.isVisible) target = self.sparkLastFocusedWindow;
      if (!target) for (NSWindow *candidate in NSApp.orderedWindows)
        if ((!hidden || candidate != self.window) && candidate.isVisible && !candidate.sheet && ![candidate isKindOfClass:NSPanel.class]) { target = candidate; break; }
    }
    if (target.isMiniaturized) [target deminiaturize:nil];
    [target makeKeyAndOrderFront:nil];
  }
  SparkEmit(@{ @"type": @"reopen", @"hasVisibleWindows": @(visible), @"mainWindowWasVisible": @(hadVisibleMainWindow) });
  // We have handled the default action; AppKit must not unhide a hidden host.
  return NO;
}
- (void)application:(NSApplication *)sender openURLs:(NSArray<NSURL *> *)urls { SparkOpenURLs(urls); }
- (void)application:(NSApplication *)sender openFiles:(NSArray<NSString *> *)files {
  NSMutableArray *urls = [NSMutableArray new];
  for (NSString *file in files) [urls addObject:[NSURL fileURLWithPath:file]];
  SparkOpenURLs(urls);
  [sender replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge { return [self bundleURL]; }
- (NSURL *)bundleURL
{
#if DEBUG
  NSString *value = NSProcessInfo.processInfo.environment[@"SPARK_BUNDLE_URL"];
  NSURL *url = value.length ? [NSURL URLWithString:value] : nil;
  if (url && ([@"127.0.0.1" isEqualToString:url.host] || [@"localhost" isEqualToString:url.host])) {
    return url;
  }
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}
- (NSMenu *)applicationDockMenu:(NSApplication *)sender { return SparkDockMenu; }
- (BOOL)concurrentRootEnabled { return YES; }
@end
