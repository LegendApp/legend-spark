#import "../packages/desktop-host/SparkEditable.mm"
static int checks;
static void check(BOOL value, NSString *message) { checks++;if (!value) { NSLog(@"FAIL: %@",message); exit(1); } }
@interface FixtureEditingController : SparkEditableController
@property NSString *receivedKey;
@end
@implementation FixtureEditingController
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
static NSDictionary *call(NSString *method,NSDictionary *args) {
  __block BOOL handled=NO,finished=NO;__block NSDictionary *result;
  void (^claim)(void)=^{handled=YES;};
  void (^reply)(NSString *,NSString *,NSString *)=^(NSString *value,NSString *code,NSString *message){
    if(code)result=@{@"error":code,@"message":message};else{NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];id decoded=[NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];result=[decoded isKindOfClass:NSDictionary.class] ? decoded : @{};}finished=YES;
  };
  [NSNotificationCenter.defaultCenter postNotificationName:@"SparkEditableCall" object:nil userInfo:@{@"method":method,@"args":args,@"claim":claim,@"reply":reply}];
  check(handled,@"Opted-in native host claims bridge call");
  NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:3];
  while(!finished && deadline.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  check(finished,@"Bridge promise completes");return result;
}
int main(int argc, const char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  SparkEditableController *controller=[SparkEditableController new];
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
  FixtureEditingController *api=[FixtureEditingController new];api.manifest=@{@"release":@"release-1",@"editing":@{@"ui":@"custom",@"provider":@{@"kind":@"cli",@"tool":@"codex"}}};api.support=folder;api.directory=controller.directory;SEController=api;
  NSDictionary *savedProvider=[NSUserDefaults.standardUserDefaults dictionaryForKey:@"SparkEditableProvider"];
  [NSUserDefaults.standardUserDefaults removeObjectForKey:@"SparkEditableProvider"];
  __block int events=0;id observer=[NSNotificationCenter.defaultCenter addObserverForName:@"SparkDesktopEvent" object:nil queue:nil usingBlock:^(NSNotification *note){if([note.userInfo[@"type"] isEqual:@"editingState"])events++;}];
  check([call(@"state",@{})[@"enabled"] boolValue],@"Public state reports enabled");
  check([[call(@"state",@{})[@"provider"] objectForKey:@"kind"] isEqual:@"cli"],@"Published CLI defaults are available");
  check([call(@"configure",@{@"provider":@{@"kind":@"cli",@"tool":@"claude"}}) count]==0,@"Configures CLI without an API key");
  check([call(@"configure",@{@"provider":@{@"kind":@"local",@"endpoint":@"http://evil.test/chat",@"model":@"test"}})[@"error"] isEqual:@"E_INVALID_ARGUMENT"],@"Rejects non-loopback local provider");
  check([call(@"prompt",@{@"prompt":@"Make it blue"})[@"error"] isEqual:@"E_PERMISSION"],@"CLI needs source-sharing consent");
  NSDictionary *generated=call(@"prompt",@{@"prompt":@"Make it blue",@"allowSourceSharing":@YES});
  check([generated[@"candidate"] isEqual:@"fixture"],@"Custom UI gets compiled candidate result");check(api.receivedKey==nil,@"CLI never receives a Keychain API key");
  check(![NSFileManager.defaultManager fileExistsAtPath:[api path:@"request.json"]],@"Per-request input removed after completion");
  NSDictionary *review=call(@"review",@{});check([review[@"text"] isEqual:@"Complete candidate review"],@"Custom UI receives full review");check([review[@"prompts"] count]==1,@"Custom UI receives saved prompt history");
  check(review[@"prompts"][0][@"patch"]==nil,@"Review metadata does not duplicate stored file contents");
  api.busy=YES;check([call(@"original",@{})[@"error"] isEqual:@"E_BUSY"],@"Recovery action cannot race an ongoing operation");api.busy=NO;
  check(events>=3,@"Native progress reaches public event transport");
  check(SparkEditableDockMenu(nil).numberOfItems==0,@"Custom UI disables automatic Dock button");
  [api show:nil];check(api.providerChoice.indexOfSelectedItem==1,@"Built-in UI can still open with selected CLI");check(!api.key.enabled,@"CLI UI does not require API key");[api.panel close];
  [NSNotificationCenter.defaultCenter removeObserver:observer];[NSNotificationCenter.defaultCenter removeObserver:api];
  if(savedProvider)[NSUserDefaults.standardUserDefaults setObject:savedProvider forKey:@"SparkEditableProvider"];else[NSUserDefaults.standardUserDefaults removeObjectForKey:@"SparkEditableProvider"];
  [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
  printf("Editable native loader and API: %d checks passed\n",checks);
} return 0; }
