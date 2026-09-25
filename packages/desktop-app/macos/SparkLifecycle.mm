#import "SparkLifecycle.h"
#import <QuartzCore/QuartzCore.h>

static NSArray<id<SparkStartupPlugin>> *plugins;
static double mainWindowShown = 0;
static double mainRootAttached = 0;
NSDictionary *SparkLifecycleConfiguration(void) {
  return [NSBundle.mainBundle objectForInfoDictionaryKey:@"SparkLifecycleConfiguration"] ?: @{};
}
void SparkPrepareApplication(void) {
  NSCAssert(NSThread.isMainThread, @"Startup is main-thread confined");
  NSString *appearance = SparkLifecycleConfiguration()[@"appearance"];
  if (appearance) NSApp.appearance = [appearance isEqual:@"dark"] ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua] : [appearance isEqual:@"light"] ? [NSAppearance appearanceNamed:NSAppearanceNameAqua] : nil;
  NSMutableArray *instances = [NSMutableArray new];
  NSUInteger rootOwners = 0;
  for (NSString *name in SparkLifecycleConfiguration()[@"plugins"] ?: @[]) {
    Class type = NSClassFromString(name);
    if (!type || ![type conformsToProtocol:@protocol(SparkStartupPlugin)])
      [NSException raise:NSInvalidArgumentException format:@"Startup plugin %@ is not linked or does not implement SparkStartupPlugin", name];
    id<SparkStartupPlugin> plugin = [type new];
    if ([plugin respondsToSelector:@selector(attachRootView:toWindow:installRoot:)]) rootOwners++;
    [instances addObject:plugin];
  }
  if (rootOwners > 1) [NSException raise:NSInvalidArgumentException format:@"Only one startup plugin may own main root attachment"];
  plugins = instances;
  for (id<SparkStartupPlugin> plugin in plugins)
    if ([plugin respondsToSelector:@selector(prepareApplication)]) [plugin prepareApplication];
}
void SparkPrepareMainWindow(NSWindow *window) {
  for (id<SparkStartupPlugin> plugin in plugins)
    if ([plugin respondsToSelector:@selector(prepareMainWindow:)]) [plugin prepareMainWindow:window];
}
void SparkAttachMainRootView(NSView *root, NSWindow *window, void (^installRoot)(void)) {
  BOOL attached = NO;
  for (id<SparkStartupPlugin> plugin in plugins) {
    if ([plugin respondsToSelector:@selector(attachRootView:toWindow:installRoot:)]) {
      [plugin attachRootView:root toWindow:window installRoot:installRoot]; attached = YES;
    }
  }
  if (!attached) installRoot();
  mainRootAttached = CACurrentMediaTime() * 1000;
}
void SparkRecordMainWindowShown(void) { if (!mainWindowShown) mainWindowShown = CACurrentMediaTime() * 1000; }
NSDictionary *SparkStartupTiming(void) {
  NSMutableDictionary *result = [NSMutableDictionary new];
  if (mainWindowShown) result[@"mainWindowFirstVisibleTime"] = @(mainWindowShown);
  if (mainRootAttached) result[@"mainWindowReactRootAttachedTime"] = @(mainRootAttached);
  return result;
}
