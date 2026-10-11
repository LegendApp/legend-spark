#import "SparkDesktop.h"
#import "SparkDesktopError.h"
#import "SparkQuitCoordinator.h"
#import "SparkInstance.h"
#import "SparkTestDriver.h"
#import <sys/wait.h>
#import <CommonCrypto/CommonDigest.h>
NSString * const SparkDesktopEvent = @"SparkDesktopEvent";
static NSMutableDictionary<NSString *, NSDictionary *> *jsQuitReplies;
static NSUInteger quitGeneration = 0;
static NSMutableArray *pendingURLs;
static NSString *initialURL;
static BOOL launchComplete = NO;
// Non-nil only in a second process, which forwards its open requests instead of handling them.
static NSMutableArray<NSURL *> *forwardedURLs;

NSString *SparkJSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}
NSDictionary *SparkArgs(NSString *json) {
  id value = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? value : @{};
}
void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
void SparkReject(RCTPromiseRejectBlock reject, NSError *error) {
  reject(SparkDesktopErrorCode(error), error.localizedDescription ?: @"Native operation failed", error);
}
NSDictionary *SparkContext(void) {
  static NSDictionary *context;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSBundle *bundle = NSBundle.mainBundle;
    NSString *runtimePath = [bundle pathForResource:@"spark-runtime" ofType:@"json"];
    NSData *data = runtimePath ? [NSData dataWithContentsOfFile:runtimePath] : nil;
    id rawRuntime = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSDictionary *runtime = [rawRuntime isKindOfClass:NSDictionary.class] ? rawRuntime : @{};
    NSString *project = [bundle objectForInfoDictionaryKey:@"SparkProjectIdentifier"] ?: bundle.bundleIdentifier;
    NSString *version = [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"0.0.0";
    NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"];
#if DEBUG
    // Only the reusable Go host takes identity from its launching CLI.
    if ([runtime[@"mode"] isEqual:@"go"]) {
      project = NSProcessInfo.processInfo.environment[@"SPARK_PROJECT_ID"] ?: project;
      version = NSProcessInfo.processInfo.environment[@"SPARK_PROJECT_VERSION"] ?: version;
      name = NSProcessInfo.processInfo.environment[@"SPARK_PROJECT_NAME"] ?: name;
    }
#endif
    context = @{ @"projectId": project ?: @"desktop.app", @"name": name ?: @"Desktop App",
      @"version": version,
      @"runtime": runtime ?: @{}, @"launchArguments": NSProcessInfo.processInfo.arguments };
  });
  return context;
}
NSString *SparkNamespace(void) {
  NSString *project = SparkContext()[@"projectId"];
  NSData *data = [project dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, hash);
  NSMutableString *result = [NSMutableString stringWithString:@"spark.desktop."];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [result appendFormat:@"%02x", hash[i]];
  return result;
}
NSDictionary *SparkInitialProps(NSString *windowID, NSDictionary *props) {
  NSMutableDictionary *result = [SparkContext() mutableCopy];
  result[@"windowId"] = windowID;
  result[@"windowProps"] = props ?: @{};
  return result;
}
void SparkEmit(NSDictionary *event) {
  NSCAssert(NSThread.isMainThread, @"Desktop events are main-thread confined");
  [NSNotificationCenter.defaultCenter postNotificationName:SparkDesktopEvent object:nil userInfo:event];
}
void SparkMarkLaunchComplete(void) { launchComplete = YES; }
NSString *SparkInitialURL(void) { return initialURL; }
void SparkOpenURLs(NSArray<NSURL *> *urls) {
  if (forwardedURLs) { [forwardedURLs addObjectsFromArray:urls]; return; }
  if (!pendingURLs) pendingURLs = [NSMutableArray new];
  for (NSURL *url in urls) {
    if (!launchComplete && !url.isFileURL && !initialURL) initialURL = url.absoluteString;
    NSDictionary *event = @{ @"type": url.isFileURL ? @"openFile" : @"openURL", @"url": url.absoluteString,
      @"id": NSUUID.UUID.UUIDString, @"initial": @(!launchComplete) };
    [pendingURLs addObject:event];
    if (pendingURLs.count > 100) [pendingURLs removeObjectAtIndex:0];
    SparkEmit(event);
  }
}
NSArray *SparkPendingURLs(void) { return [pendingURLs copy] ?: @[]; }
static SparkQuitCoordinator *SparkQuitCoordinatorInstance(void) {
  static SparkQuitCoordinator *coordinator;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ coordinator = [[SparkQuitCoordinator alloc] initWithReply:^(BOOL allow) {
    [NSApp replyToApplicationShouldTerminate:allow];
  } timeout:30]; });
  return coordinator;
}
void SparkRegisterQuitHandler(NSString *identifier, SparkQuitHandler handler) { [SparkQuitCoordinatorInstance() registerHandler:identifier handler:handler]; }
void SparkRemoveQuitHandler(NSString *identifier) { [SparkQuitCoordinatorInstance() removeHandler:identifier]; }
void SparkSetQuitGuard(NSString *identifier, BOOL value) {
  if (!jsQuitReplies) jsQuitReplies = [NSMutableDictionary new];
  NSString *key = [@"spark.javascript." stringByAppendingString:identifier];
  if (value) SparkRegisterQuitHandler(key, ^(SparkQuitReply reply) {
    NSUInteger generation = ++quitGeneration;
    jsQuitReplies[identifier] = @{ @"generation": @(generation), @"reply": [reply copy] };
    SparkEmit(@{ @"type": @"beforeQuit", @"guardId": identifier, @"requestId": @(generation) });
  });
  else { [jsQuitReplies removeObjectForKey:identifier]; SparkRemoveQuitHandler(key); }
}
void SparkReplyQuit(NSString *identifier, BOOL allow, NSUInteger generation) {
  NSDictionary *pending = jsQuitReplies[identifier];
  if (!pending || [pending[@"generation"] unsignedIntegerValue] != generation) return;
  SparkQuitReply reply = pending[@"reply"]; [jsQuitReplies removeObjectForKey:identifier]; reply(allow);
}
void SparkObserveQuitDecision(SparkQuitReply observer) { [SparkQuitCoordinatorInstance() observeDecision:observer]; }
NSApplicationTerminateReply SparkShouldQuit(void) { return [SparkQuitCoordinatorInstance() requestQuit]; }

// A forwarded launch reaches the owner as both a secondInstance event and, for its
// files and URLs, the same replayable open requests as a direct launch.
static void SparkReceiveLaunch(NSDictionary *launch) {
  [NSApp activateIgnoringOtherApps:YES];
  BOOL visible = NO;
  for (NSWindow *window in NSApp.orderedWindows) if (window.isVisible && ![window isKindOfClass:NSPanel.class]) { visible = YES; break; }
  [NSApp.delegate applicationShouldHandleReopen:NSApp hasVisibleWindows:visible];
  SparkEmit(@{ @"type": @"secondInstance", @"arguments": launch[@"arguments"], @"workingDirectory": launch[@"workingDirectory"], @"files": launch[@"files"], @"urls": launch[@"urls"] });
  NSMutableArray<NSURL *> *urls = [NSMutableArray new];
  for (NSString *path in launch[@"files"]) [urls addObject:[NSURL fileURLWithPath:path]];
  for (NSString *value in launch[@"urls"]) { NSURL *url = [NSURL URLWithString:value]; if (url) [urls addObject:url]; }
  if (urls.count) SparkOpenURLs(urls);
}
[[noreturn]] static void SparkLaunchFailed(NSString *message, NSError *error) {
  NSLog(@"%@: %@", message, error.localizedDescription);
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [NSAlert new];
  alert.messageText = message;
  alert.informativeText = error.localizedDescription;
  [alert runModal];
  exit(1);
}
// The second process stays invisible until AppKit has delivered the open requests it
// was launched with (they arrive before didFinishLaunching), then forwards and exits.
static void SparkForwardLaunch(void) {
  forwardedURLs = [NSMutableArray new];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  __block id observer = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    [NSNotificationCenter.defaultCenter removeObserver:observer];
    NSMutableArray<NSString *> *files = [NSMutableArray new], *urls = [NSMutableArray new];
    for (NSURL *url in forwardedURLs) { if (url.isFileURL) [files addObject:url.path]; else [urls addObject:url.absoluteString]; }
    NSDictionary *launch = @{ @"arguments": NSProcessInfo.processInfo.arguments, @"workingDirectory": NSFileManager.defaultManager.currentDirectoryPath ?: @"/", @"files": files, @"urls": urls };
    NSError *error;
    if (!SparkInstanceForward(NSTemporaryDirectory(), SparkNamespace(), launch, 10, &error)) SparkLaunchFailed(@"The running app did not accept this launch", error);
    exit(0);
  }];
}
static NSString *safeModeTrigger;
static BOOL relaunched = NO, instanceOwner = NO;
BOOL SparkSafeMode(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    if ([NSProcessInfo.processInfo.arguments containsObject:@"--spark-safe-mode"]) safeModeTrigger = @"flag";
    // A test-driver session never reads the keyboard: someone typing while it launches must not change the run.
    else if (!SparkTestDriverActive() && (NSEvent.modifierFlags & NSEventModifierFlagShift)) safeModeTrigger = @"modifier";
  });
  return safeModeTrigger != nil;
}
NSDictionary *SparkLaunchState(void) {
  return @{ @"safeMode": SparkSafeMode() ? safeModeTrigger : NSNull.null, @"relaunched": @(relaunched),
    @"instance": instanceOwner ? @"primary" : @"test-driver" };
}
BOOL SparkAcquireInstance(void) {
  SparkSafeMode();
  NSString *parent = NSProcessInfo.processInfo.environment[@"SPARK_RELAUNCH_PARENT"];
  NSError *error;
  if (parent) {
    unsetenv("SPARK_RELAUNCH_PARENT");
    relaunched = YES;
    // The previous instance holds the lock until it exits; it kills this process if its quit is vetoed.
    if (!SparkInstanceWaitForExit(parent.intValue, &error)) SparkLaunchFailed(@"Unable to relaunch", error);
  }
  instanceOwner = SparkInstanceAcquire(NSTemporaryDirectory(), SparkNamespace(), ^(NSDictionary *launch) { SparkReceiveLaunch(launch); }, &error);
  if (error) SparkLaunchFailed(@"Unable to establish the app instance lock", error);
  if (!instanceOwner) SparkForwardLaunch();
  return instanceOwner;
}
static pid_t relaunchChild = 0;
void SparkRelaunch(NSArray<NSString *> *arguments, void (^completion)(NSDictionary *result, NSError *error)) {
  if (!relaunchChild) {
    NSError *error;
    relaunchChild = SparkInstanceSpawnRelaunch(arguments, &error);
    if (!relaunchChild) { completion(nil, error); return; }
  }
  SparkObserveQuitDecision(^(BOOL allow) {
    if (!allow && relaunchChild) { kill(relaunchChild, SIGKILL); waitpid(relaunchChild, NULL, 0); relaunchChild = 0; }
    completion(allow ? @{ @"quitRequested": @YES } : @{ @"quitRequested": @NO, @"reason": @"vetoed" }, nil);
  });
  [NSRunLoop.mainRunLoop performBlock:^{ [NSApp terminate:nil]; }];
}
NSMenu *SparkDockMenu = nil;
