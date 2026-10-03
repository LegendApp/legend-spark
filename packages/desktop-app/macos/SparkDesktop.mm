#import "SparkDesktop.h"
#import "SparkDesktopError.h"
#import "SparkQuitCoordinator.h"
#import <CommonCrypto/CommonDigest.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
NSString * const SparkDesktopEvent = @"SparkDesktopEvent";
static NSMutableDictionary<NSString *, NSDictionary *> *jsQuitReplies;
static NSUInteger quitGeneration = 0;
static NSMutableArray *pendingURLs;
static NSString *initialURL;
static BOOL launchComplete = NO;

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

BOOL SparkAcquireInstance(void) {
  static int lockFD = -1;
  static id observer;
  NSString *lockPath = [NSTemporaryDirectory() stringByAppendingPathComponent:[SparkNamespace() stringByAppendingString:@".lock"]];
  lockFD = open(lockPath.fileSystemRepresentation, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (lockFD < 0) { NSLog(@"Unable to establish desktop instance lock: %s", strerror(errno)); return YES; }
  NSString *name = [SparkNamespace() stringByAppendingString:@".secondInstance"];
  if (flock(lockFD, LOCK_EX | LOCK_NB) != 0) {
    close(lockFD); lockFD = -1;
    [NSDistributedNotificationCenter.defaultCenter postNotificationName:name object:nil userInfo:@{ @"arguments": NSProcessInfo.processInfo.arguments } deliverImmediately:YES];
    return NO;
  }
  observer = [NSDistributedNotificationCenter.defaultCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    [NSApp activateIgnoringOtherApps:YES];
    BOOL visible = NO;
    for (NSWindow *window in NSApp.orderedWindows) if (window.isVisible && ![window isKindOfClass:NSPanel.class]) { visible = YES; break; }
    [NSApp.delegate applicationShouldHandleReopen:NSApp hasVisibleWindows:visible];
    SparkEmit(@{ @"type": @"secondInstance", @"arguments": note.userInfo[@"arguments"] ?: @[] });
  }];
  return YES;
}
NSMenu *SparkDockMenu = nil;
