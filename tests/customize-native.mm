#import "../packages/desktop-host/SparkCustomize.mm"
#import <objc/runtime.h>
static int checks;
static void check(BOOL value, NSString *message) { checks++;if (!value) { NSLog(@"FAIL: %@",message); exit(1); } }
static int installedMonitors;
@interface NSEvent (SparkCustomizeTest)
+ (id)sparkFixtureMonitor:(NSEventMask)mask handler:(NSEvent *(^)(NSEvent *))handler;
@end
@implementation NSEvent (SparkCustomizeTest)
+ (id)sparkFixtureMonitor:(NSEventMask)mask handler:(NSEvent *(^)(NSEvent *))handler {
  installedMonitors++;return [self sparkFixtureMonitor:mask handler:handler];
}
@end
@interface FixtureCustomizeController : SparkCustomizeController
@property NSString *receivedKey;
@property NSString *githubToken;
@end
@implementation FixtureCustomizeController
- (NSString *)githubCredential:(NSString *)value { if(value)self.githubToken=value;return self.githubToken ?: @""; }
- (BOOL)githubAuthenticated { return self.githubToken.length>0; }
- (NSDictionary *)github:(NSString *)command request:(NSDictionary *)request {
  if([command isEqual:@"begin"])return @{@"userCode":@"CODE",@"verificationUri":@"https://github.com/login/device",@"expiresIn":@900,@"deviceCode":@"private-device-code",@"clientId":@"client",@"interval":@5};
  if([command isEqual:@"complete"])return @{@"token":@"private-token"};
  return @{@"url":@"https://github.com/owner/app/pull/1",@"number":@1,@"repository":@"owner/app",@"branch":@"spark-customize-test"};
}
- (void)prepare {}
- (NSString *)worker:(NSArray *)args key:(NSString *)key {
  self.receivedKey=key;
  if([args.firstObject isEqual:@"prompt"]){
    NSDictionary *request=SERead(args[2]);SEWrite([self path:@"ready.json"],@{@"candidate":@"fixture"});
    SEWrite([self path:@"state.json"],@{@"history":@[@{@"prompt":request[@"prompt"],@"status":@"needs-review",@"patch":@[@{@"contents":@"File contents stay on disk"}]}]});
    [@"Complete candidate review" writeToFile:[self path:@"review.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    return @"{\"candidate\":\"fixture\",\"status\":\"needs-review\",\"summary\":\"Edited\",\"changedFiles\":[\"App.js\"]}";
  }
  return @"{}";
}
@end
@interface FixtureGitHubTransport : SparkCustomizeController
@end
@implementation FixtureGitHubTransport
- (NSString *)download:(NSDictionary *)asset kind:(NSString *)kind { return self.toolkit; }
@end
static NSDictionary *call(NSString *method,NSDictionary *args) {
  __block BOOL handled=NO,finished=NO;__block NSDictionary *result;
  void (^claim)(void)=^{handled=YES;};
  void (^reply)(NSString *,NSString *,NSString *)=^(NSString *value,NSString *code,NSString *message){
    if(code)result=@{@"error":code,@"message":message};else{NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];id decoded=[NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];result=[decoded isKindOfClass:NSDictionary.class] ? decoded : @{};}finished=YES;
  };
  [NSNotificationCenter.defaultCenter postNotificationName:@"SparkCustomizeCall" object:nil userInfo:@{@"method":method,@"args":args,@"claim":claim,@"reply":reply}];
  check(handled,@"Opted-in native host claims bridge call");
  NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];
  while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  check(finished,@"Bridge promise completes");return result;
}
int main(int argc, const char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  Method originalMonitor=class_getClassMethod(NSEvent.class,@selector(addLocalMonitorForEventsMatchingMask:handler:));
  Method fixtureMonitor=class_getClassMethod(NSEvent.class,@selector(sparkFixtureMonitor:handler:));
  method_exchangeImplementations(originalMonitor,fixtureMonitor);
  SparkCustomizeController *controller=[SparkCustomizeController new];
  check(controller.manifest.count==0 && installedMonitors==0,@"App without customize manifest does not install a key monitor");
  method_exchangeImplementations(originalMonitor,fixtureMonitor);
  SEController=controller;NSMenu *existingMenu=[NSMenu new];[existingMenu addItemWithTitle:@"Existing item" action:nil keyEquivalent:@""];
  check(SparkCustomizeDockMenu(existingMenu)==existingMenu && existingMenu.numberOfItems==1,@"App without customize manifest preserves its Dock menu");
  check(SparkCustomizeDockMenu(nil)==nil,@"App without customize manifest does not add a Dock menu");
  NSString *folder=[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  controller.support=folder;controller.directory=[folder stringByAppendingPathComponent:@"release"];
  controller.manifest=@{@"schema":@1,@"release":@"release-1",@"runtime":@{@"fingerprint":@"native-1"}};
  NSString *build=@"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  NSString *file=[[[controller.directory stringByAppendingPathComponent:@"builds"] stringByAppendingPathComponent:build] stringByAppendingPathComponent:@"main.jsbundle"];
  [NSFileManager.defaultManager createDirectoryAtPath:file.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  [@"compiled custom bundle" writeToFile:file atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSDictionary *active=@{@"release":@"release-1",@"fingerprint":@"native-1",@"build":build,@"bundleHash":SEHash(file)};
  SEWrite([controller path:@"active.json"],active);
  check([[controller bundleURL].path isEqual:file],@"Loads compatible custom bundle");
  controller.forceOriginal=YES;check(![[controller bundleURL].path isEqual:file],@"Factory override ignores custom bundle");controller.forceOriginal=NO;
  NSMutableDictionary *wrong=[active mutableCopy];wrong[@"fingerprint"]=@"old-shell";SEWrite([controller path:@"active.json"],wrong);
  check(![[controller bundleURL].path isEqual:file],@"Rejects old native fingerprint");
  SEWrite([controller path:@"active.json"],active);SEWrite([controller path:@"pending.json"],@{@"launched":@YES,@"previous":@{}});controller.started=NO;
  check(![[controller bundleURL].path isEqual:file],@"Rolls back interrupted first launch");
  SEWrite([controller path:@"active.json"],active);SEWrite([controller path:@"pending.json"],@{@"launched":@NO,@"previous":@{}});controller.started=NO;
  check([[controller bundleURL].path isEqual:file],@"Activates pending candidate");
  check([SERead([controller path:@"pending.json"])[@"launched"] boolValue],@"Records launch before executing JS");
  [controller recoverActivation:@"an-older-preview"];check(!controller.forceOriginal,@"Old preview timeout cannot roll back a newer activation");
  [controller healthy:nil];check(!SERead([controller path:@"pending.json"]).count,@"First render acknowledges startup");
  [@"corrupt" writeToFile:file atomically:YES encoding:NSUTF8StringEncoding error:nil];check(![[controller bundleURL].path isEqual:file],@"Rejects corrupted bytecode");
  [@"Prompt: Make the greeting blue.\n\nCandidate ready for review.\n\n--- index.js\n+++ index.js\n- original\n+ customized\n" writeToFile:[controller path:@"review.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  if(argc>1 && strcmp(argv[1],"--ui")==0){[controller show:nil];[NSApp run];}
  // Switch the notification owner, then exercise the actual asynchronous native
  // API used by custom React UI, without downloading tools or calling a model.
  [NSNotificationCenter.defaultCenter removeObserver:controller];
  FixtureCustomizeController *api=[FixtureCustomizeController new];api.manifest=@{@"release":@"release-1",@"repository":@"owner/app",@"customize":@{@"ui":@"custom",@"githubClientId":@"client",@"provider":@{@"kind":@"cli",@"tool":@"codex"}}};api.support=folder;api.directory=controller.directory;SEController=api;
  NSDictionary *savedProvider=[NSUserDefaults.standardUserDefaults dictionaryForKey:@"SparkCustomizeProvider"];
  [NSUserDefaults.standardUserDefaults removeObjectForKey:@"SparkCustomizeProvider"];
  __block int events=0;id observer=[NSNotificationCenter.defaultCenter addObserverForName:@"SparkDesktopEvent" object:nil queue:nil usingBlock:^(NSNotification *note){if([note.userInfo[@"type"] isEqual:@"customizeState"])events++;}];
  check([call(@"state",@{})[@"enabled"] boolValue],@"Public state reports enabled");
  check([[call(@"state",@{})[@"provider"] objectForKey:@"kind"] isEqual:@"cli"],@"Published CLI defaults are available");
  check([call(@"configure",@{@"provider":@{@"kind":@"cli",@"tool":@"claude"}}) count]==0,@"Configures CLI without an API key");
  check([call(@"configure",@{@"provider":@{@"kind":@"local",@"endpoint":@"http://evil.test/chat",@"model":@"test"}})[@"error"] isEqual:@"E_INVALID_ARGUMENT"],@"Rejects non-loopback local provider");
  check([call(@"prompt",@{@"prompt":@"Make it blue"})[@"error"] isEqual:@"E_PERMISSION_DENIED"],@"CLI needs source-sharing consent");
  NSDictionary *generated=call(@"prompt",@{@"prompt":@"Make it blue",@"allowSourceSharing":@YES});
  check([generated[@"candidate"] isEqual:@"fixture"],@"Custom UI gets compiled candidate result");check(api.receivedKey==nil,@"CLI never receives a Keychain API key");
  check(![NSFileManager.defaultManager fileExistsAtPath:[api path:@"request.json"]],@"Per-request input removed after completion");
  NSDictionary *review=call(@"review",@{});check([review[@"text"] isEqual:@"Complete candidate review"],@"Custom UI receives full review");check([review[@"prompts"] count]==1,@"Custom UI receives saved prompt history");
  check(review[@"prompts"][0][@"patch"]==nil,@"Review metadata does not duplicate stored file contents");
  NSDictionary *authorization=call(@"githubBegin",@{});check([authorization[@"userCode"] isEqual:@"CODE"],@"UI gets GitHub user code");check(authorization[@"deviceCode"]==nil,@"Device grant stays native");
  check([call(@"githubComplete",@{}) count]==0,@"Authorization completion exposes no token");check([api.githubToken isEqual:@"private-token"],@"Authorization token goes to credential store");
  NSDictionary *authorized=call(@"state",@{});check([authorized[@"githubAuthenticated"] boolValue],@"UI gets auth availability");check(authorized[@"token"]==nil,@"State exposes no token");
  check([call(@"submitPR",@{@"title":@"Blue greeting"})[@"number"] intValue]==1,@"UI can submit reviewed PR");
  call(@"githubSignOut",@{});check(!api.githubToken.length,@"Sign out removes token");
  check([call(@"submitPR",@{@"title":@"Title",@"unknown":@YES})[@"error"] isEqual:@"E_UNSUPPORTED_OPTION"],@"Customize API rejects unsupported options");
  FixtureGitHubTransport *transport=[FixtureGitHubTransport new];[NSNotificationCenter.defaultCenter removeObserver:transport];transport.toolkit=folder;transport.directory=controller.directory;transport.manifest=@{};
  [@"exec /bin/sh \"$@\"\n" writeToFile:[folder stringByAppendingPathComponent:@"runtime-bootstrap.sh"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  for(NSString *code in @[@"E_PERMISSION_DENIED",@"E_INVALID_DATA",@"E_TIMEOUT"]){
    NSString *script=[NSString stringWithFormat:@"printf '%%s\\n' '{\"error\":\"%@\",\"message\":\"Safe failure\"}'\nexit 1\n",code];
    [script writeToFile:[folder stringByAppendingPathComponent:@"customize-github.cjs"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    @try{[transport github:@"begin" request:@{}];check(NO,@"Failed subprocess must reject");}
    @catch(NSException *failure){check([failure.name isEqual:code] && [failure.reason isEqual:@"Safe failure"],@"Native GitHub subprocess retains typed error without exposing process output");}
  }
  api.busy=YES;check([call(@"original",@{})[@"error"] isEqual:@"E_BUSY"],@"Recovery action cannot race an ongoing operation");api.busy=NO;
  check(events>=3,@"Native progress reaches public event transport");
  check(SparkCustomizeDockMenu(nil).numberOfItems==0,@"Custom UI disables automatic Dock button");
  [api show:nil];check(api.providerChoice.indexOfSelectedItem==1,@"Built-in UI can still open with selected CLI");check(!api.key.enabled,@"CLI UI does not require API key");[api.panel close];
  [NSNotificationCenter.defaultCenter removeObserver:observer];[NSNotificationCenter.defaultCenter removeObserver:api];
  if(savedProvider)[NSUserDefaults.standardUserDefaults setObject:savedProvider forKey:@"SparkCustomizeProvider"];else[NSUserDefaults.standardUserDefaults removeObjectForKey:@"SparkCustomizeProvider"];
  [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
  printf("Customize native loader and API: %d checks passed\n",checks);
} return 0; }
