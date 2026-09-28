#import "../packages/desktop-host/SparkEditable.mm"
static void check(BOOL value, NSString *message) { if (!value) { NSLog(@"FAIL: %@",message); exit(1); } }
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
  [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
  puts("Editable native loader: 9 checks passed");
} return 0; }
