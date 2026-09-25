#import "AppDelegate.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <React/RCTBundleURLProvider.h>
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

#if __has_include(<NativeComposeThreadedRuntime/ThreadedRuntime.h>)
#import <NativeComposeThreadedRuntime/ThreadedRuntime.h>
#import <React/RCTReloadCommand.h>
#endif

@implementation AppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  if (!SparkAcquireInstance()) { [NSApp terminate:nil]; return; }
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
  [super applicationDidFinishLaunching:notification];
}
#if __has_include(<NativeComposeThreadedRuntime/ThreadedRuntime.h>)
- (void)sparkResetRuntimes:(NSNotification *)notification { [ThreadedRuntime destroyAllRuntimes]; }
- (void)applicationWillTerminate:(NSNotification *)notification { [ThreadedRuntime destroyAllRuntimes]; }
#endif
- (void)loadReactNativeWindow:(NSDictionary *)launchOptions {
  NSView *root = [self.rootViewFactory viewWithModuleName:self.moduleName initialProperties:self.initialProps launchOptions:launchOptions];
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 700)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
    backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.identifier = @"spark.main";
  self.window.title = SparkContext()[@"name"];
  root.frame = NSMakeRect(0, 0, 1000, 700);
  self.window.contentView = SparkWindowContent(root);
  NSDictionary *options = SparkWindowConfiguration();
  SparkApplyWindowOptions(self.window, options);
  SparkRestoreWindow(self.window, @"main", options);
  if (![[NSBundle.mainBundle objectForInfoDictionaryKey:@"SparkMenuBarOnly"] boolValue]) [self.window makeKeyAndOrderFront:nil];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return SparkShouldQuit(); }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }
- (void)applicationDidBecomeActive:(NSNotification *)note { SparkEmit(@{ @"type": @"activate" }); }
- (void)applicationDidResignActive:(NSNotification *)note { SparkEmit(@{ @"type": @"deactivate" }); }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
  if (!visible) for (NSWindow *window in NSApp.windows) if ([window.identifier isEqual:@"spark.main"]) [window makeKeyAndOrderFront:nil];
  SparkEmit(@{ @"type": @"reopen" }); return YES;
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
