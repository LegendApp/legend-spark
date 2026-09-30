// Included in AppDelegate only for editable releases. Uses OS frameworks, no JS tooling at startup.
#import <AppKit/AppKit.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>

static NSDictionary *SERead(NSString *file) {
  NSData *data = [NSData dataWithContentsOfFile:file];
  id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [value isKindOfClass:NSDictionary.class] ? value : @{};
}
static void SEWrite(NSString *file, NSDictionary *value) {
  [NSFileManager.defaultManager createDirectoryAtPath:file.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil];
  NSError *error;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&error];
  if (!data || ![data writeToFile:file options:NSDataWritingAtomic error:&error]) @throw [NSException exceptionWithName:@"SparkEditable" reason:error.localizedDescription userInfo:nil];
}
static NSString *SEHash(NSString *file) {
  NSInputStream *stream = [NSInputStream inputStreamWithFileAtPath:file]; [stream open];
  CC_SHA256_CTX context; CC_SHA256_Init(&context);
  uint8_t buffer[65536]; NSInteger count;
  while ((count = [stream read:buffer maxLength:sizeof(buffer)]) > 0) CC_SHA256_Update(&context, buffer, (CC_LONG)count);
  [stream close]; if (count < 0) return @"";
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(bytes, &context);
  NSMutableString *result = [NSMutableString new]; for (NSUInteger i=0;i<sizeof(bytes);i++) [result appendFormat:@"%02x",bytes[i]]; return result;
}
static BOOL SEIdentifier(NSString *value, NSString *pattern) {
  return [value isKindOfClass:NSString.class] && [value rangeOfString:pattern options:NSRegularExpressionSearch].location != NSNotFound;
}
static NSMutableSet<NSTask *> *SETasks;
static BOOL SECancelRequested;
static NSDictionary *SEResult(NSString *output) {
  for (NSString *line in [[output componentsSeparatedByString:@"\n"] reverseObjectEnumerator]) {
    NSData *data=[line dataUsingEncoding:NSUTF8StringEncoding];
    id value=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if([value isKindOfClass:NSDictionary.class])return value;
  }
  @throw [NSException exceptionWithName:@"E_INVALID_DATA" reason:@"Editing worker returned invalid data" userInfo:nil];
}
static NSString *SEPath(void) {
  NSString *current=NSProcessInfo.processInfo.environment[@"PATH"] ?: @"/usr/bin:/bin:/usr/sbin:/sbin";
  return [NSString stringWithFormat:@"%@/.local/bin:%@/.bun/bin:%@/.claude/local:/opt/homebrew/bin:/usr/local/bin:%@",NSHomeDirectory(),NSHomeDirectory(),NSHomeDirectory(),current];
}
static NSDictionary *SEProvider(NSDictionary *value) {
  if(![value isKindOfClass:NSDictionary.class])@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Invalid editing provider" userInfo:nil];
  NSString *kind=value[@"kind"],*model=value[@"model"];
  if([kind isEqual:@"cli"]) {
    if(![@[@"codex",@"claude"] containsObject:value[@"tool"]] || (model && (![model isKindOfClass:NSString.class] || !model.length)))@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"CLI provider requires codex or claude" userInfo:nil];
    for(NSString *key in value)if(![@[@"kind",@"tool",@"model"] containsObject:key])@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Unknown CLI provider option" userInfo:nil];
    NSMutableDictionary *result=[@{@"kind":kind,@"tool":value[@"tool"]} mutableCopy];if(model)result[@"model"]=model;return result;
  }
  for(NSString *key in value)if(![@[@"kind",@"endpoint",@"model",@"apiKey"] containsObject:key])@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Unknown editing provider option" userInfo:nil];
  if(![model isKindOfClass:NSString.class] || !model.length || ![value[@"endpoint"] isKindOfClass:NSString.class])@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Enter an endpoint and provider model" userInfo:nil];
  NSURLComponents *url=[NSURLComponents componentsWithString:value[@"endpoint"]];
  BOOL local=[kind isEqual:@"local"],remote=[kind isEqual:@"remote"];
  BOOL loopback=[@[@"localhost",@"127.0.0.1",@"::1",@"[::1]"] containsObject:url.host.lowercaseString];
  if((!local && !remote) || !url.host.length || url.user || url.password || url.query || url.fragment || (local ? !loopback || ![@[@"http",@"https"] containsObject:url.scheme.lowercaseString] : ![url.scheme.lowercaseString isEqual:@"https"]))@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Remote providers require HTTPS; local providers require a loopback HTTP(S) endpoint" userInfo:nil];
  if(local && [url.host.lowercaseString isEqual:@"localhost"])url.host=@"127.0.0.1";
  if(value[@"apiKey"] && (!remote || ![value[@"apiKey"] isKindOfClass:NSString.class]))@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"API keys are only supported for remote providers" userInfo:nil];
  return @{@"kind":kind,@"endpoint":url.string,@"model":model};
}
static NSString *SERun(NSString *executable, NSArray *arguments, NSDictionary *environment) {
  if(SECancelRequested)@throw [NSException exceptionWithName:@"E_ABORTED" reason:@"Editing canceled; partial changes are retained" userInfo:nil];
  NSTask *task = [NSTask new]; task.executableURL = [NSURL fileURLWithPath:executable]; task.arguments = arguments;
  if (environment) task.environment = environment;
  NSPipe *pipe = [NSPipe pipe]; task.standardOutput = pipe; task.standardError = pipe;
  NSError *error; if (![task launchAndReturnError:&error]) @throw [NSException exceptionWithName:@"SparkEditable" reason:error.localizedDescription userInfo:nil];
  @synchronized(NSTask.class) { if(!SETasks)SETasks=[NSMutableSet new]; [SETasks addObject:task]; if(SECancelRequested && task.running)[task terminate]; }
  NSData *data = [pipe.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
  @synchronized(NSTask.class) { [SETasks removeObject:task]; }
  NSString *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
  if(SECancelRequested)@throw [NSException exceptionWithName:@"E_ABORTED" reason:@"Editing canceled; partial changes are retained" userInfo:nil];
  if (task.terminationStatus) @throw [NSException exceptionWithName:@"SparkEditable" reason:[NSString stringWithFormat:@"%@ failed (%d). %@", executable.lastPathComponent, task.terminationStatus, output] userInfo:nil];
  return output;
}
@interface SparkEditableController : NSObject
@property NSDictionary *manifest;
@property NSDictionary *previewRecord;
@property NSString *support;
@property NSString *directory;
@property NSString *toolkit;
@property NSPanel *panel;
@property NSTextView *prompt;
@property NSTextField *status;
@property NSTextField *endpoint;
@property NSTextField *model;
@property NSPopUpButton *providerChoice;
@property NSString *phase;
@property NSString *message;
@property NSSecureTextField *key;
@property NSMutableArray<NSButton *> *buttons;
@property BOOL busy;
@property BOOL started;
@property BOOL forceOriginal;
@property NSWindow *reviewWindow;
@end
static SparkEditableController *SEController;
@implementation SparkEditableController
- (instancetype)init {
  if ((self = [super init])) {
    _manifest = SERead([NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"spark-editable.json"]);
    NSString *base = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
    _support = [[base stringByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier] stringByAppendingPathComponent:@"SparkEditable"];
    _directory = [[_support stringByAppendingPathComponent:@"releases"] stringByAppendingPathComponent:_manifest[@"release"] ?: @"disabled"];
    _phase=@"idle"; _message=@"Ready to customize";
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(handleCall:) name:@"SparkEditableCall" object:nil];
    _forceOriginal = [NSProcessInfo.processInfo.arguments containsObject:@"--spark-original"] || ([NSEvent modifierFlags] & NSEventModifierFlagOption);
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification object:nil queue:nil usingBlock:^(NSNotification *note) { @synchronized(NSTask.class) { for(NSTask *task in SETasks) if(task.running)[task terminate]; } }];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(healthy:) name:@"RCTContentDidAppearNotification" object:nil];
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
      if ((event.modifierFlags & (NSEventModifierFlagCommand|NSEventModifierFlagShift)) == (NSEventModifierFlagCommand|NSEventModifierFlagShift) && ![self.manifest[@"editing"][@"ui"] isEqual:@"custom"] && [event.charactersIgnoringModifiers.lowercaseString isEqual:@"e"]) { [self show:nil]; return nil; }
      return event;
    }];
  } return self;
}
- (NSString *)path:(NSString *)name { return [self.directory stringByAppendingPathComponent:name]; }
- (NSString *)credential:(NSString *)newValue {
  NSDictionary *query = @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:@"SparkEditableAI", (__bridge id)kSecAttrAccount:NSBundle.mainBundle.bundleIdentifier};
  if (newValue) {
    SecItemDelete((__bridge CFDictionaryRef)query);
    if (newValue.length) { NSMutableDictionary *item = [query mutableCopy]; item[(__bridge id)kSecValueData] = [newValue dataUsingEncoding:NSUTF8StringEncoding];
      OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
      if (status != errSecSuccess) @throw [NSException exceptionWithName:@"SparkEditable" reason:@"Could not save the API key in Keychain." userInfo:nil]; }
    return newValue;
  }
  NSMutableDictionary *lookup = [query mutableCopy]; lookup[(__bridge id)kSecReturnData] = @YES; CFTypeRef data = NULL;
  if (SecItemCopyMatching((__bridge CFDictionaryRef)lookup, &data) != errSecSuccess) return @"";
  return [[NSString alloc] initWithData:CFBridgingRelease(data) encoding:NSUTF8StringEncoding] ?: @"";
}
- (void)show:(id)sender {
  if (!self.manifest.count) return;
  if (!self.panel) {
    self.panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0,0,680,570) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    self.panel.title = @"Customize this app"; self.panel.releasedWhenClosed = NO;
    NSView *view = self.panel.contentView;
    NSTextField *intro = [NSTextField wrappingLabelWithString:@"Describe your change. Spark keeps the original app and saves your prompt with the patch. Review generated changes before applying them."];
    intro.frame = NSMakeRect(20,505,640,45); [view addSubview:intro];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(20,335,640,155)]; scroll.hasVerticalScroller = YES; scroll.borderType = NSBezelBorder;
    self.prompt = [[NSTextView alloc] initWithFrame:scroll.bounds]; self.prompt.richText = NO; self.prompt.font = [NSFont systemFontOfSize:14]; self.prompt.autoresizingMask = NSViewWidthSizable; self.prompt.textContainer.widthTracksTextView = YES;
    scroll.documentView = self.prompt; [view addSubview:scroll];
    self.providerChoice=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(130,296,530,26)];
    [self.providerChoice addItemsWithTitles:@[@"Codex CLI (existing login)",@"Claude CLI (existing login)",@"Local model server",@"Remote API"]];self.providerChoice.target=self;self.providerChoice.action=@selector(providerChanged:);
    NSDictionary *provider=[self provider];
    [self.providerChoice selectItemAtIndex:[provider[@"kind"] isEqual:@"cli"] ? ([provider[@"tool"] isEqual:@"claude"] ? 1 : 0) : ([provider[@"kind"] isEqual:@"local"] ? 2 : 3)];
    NSArray *labels = @[@"Endpoint", @"Model", @"API key"];
    self.endpoint = [[NSTextField alloc] initWithFrame:NSMakeRect(130,260,530,26)]; self.endpoint.stringValue = provider[@"endpoint"] ?: @"";
    self.model = [[NSTextField alloc] initWithFrame:NSMakeRect(130,224,530,26)]; self.model.stringValue = provider[@"model"] ?: @""; self.model.placeholderString = @"CLI default, or model identifier";
    self.key = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(130,188,530,26)]; self.key.placeholderString = @"Remote API only; stored in Keychain"; self.key.stringValue = [provider[@"kind"] isEqual:@"remote"] ? [self credential:nil] : @"";
    NSTextField *providerLabel=[NSTextField labelWithString:@"Provider"];providerLabel.frame=NSMakeRect(20,300,105,20);[view addSubview:providerLabel];[view addSubview:self.providerChoice];
    NSArray *fields = @[self.endpoint,self.model,self.key];
    for (NSUInteger i=0;i<3;i++) { NSTextField *label=[NSTextField labelWithString:labels[i]]; label.frame=NSMakeRect(20,264-36*i,105,20); [view addSubview:label]; [view addSubview:fields[i]]; }
    [self syncProviderFields];
    self.buttons = [NSMutableArray new];
    NSArray *titles = @[@"Generate",@"Migrate edits",@"Review",@"Preview",@"Apply",@"Original"];
    NSArray *selectors = @[@"generate:",@"migrate:",@"review:",@"preview:",@"apply:",@"original:"];
    for (NSUInteger i=0;i<titles.count;i++) {
      NSButton *button = [NSButton buttonWithTitle:titles[i] target:self action:NSSelectorFromString(selectors[i])]; button.frame=NSMakeRect(20+(i%3)*215,145-(i/3)*40,205,32); [view addSubview:button]; [self.buttons addObject:button];
    }
    self.status = [NSTextField wrappingLabelWithString:@"Tools download on first use. AI requests send relevant source to your chosen provider and may incur charges. Hold Option at launch to use the original app."];
    long long bytes=[self.manifest[@"source"][@"size"] longLongValue]+[self.manifest[@"toolkit"][@"size"] longLongValue];
    if(bytes>0)self.status.stringValue=[NSString stringWithFormat:@"First-use source and tools: %@, plus Bun if needed. AI sends relevant source to your chosen provider. Hold Option at launch for the original app.",[NSByteCountFormatter stringFromByteCount:bytes countStyle:NSByteCountFormatterCountStyleFile]];
    self.status.frame=NSMakeRect(20,20,640,85); [view addSubview:self.status]; [self.panel center];
  }
  [self.panel makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
  if(self.busy){for(NSButton *button in self.buttons)button.enabled=NO;self.buttons.firstObject.title=@"Cancel";self.buttons.firstObject.enabled=YES;self.providerChoice.enabled=NO;self.endpoint.enabled=NO;self.model.enabled=NO;self.key.enabled=NO;}
}
- (NSDictionary *)provider {
  NSUserDefaults *defaults=NSUserDefaults.standardUserDefaults;
  NSDictionary *launch=[defaults volatileDomainForName:NSArgumentDomain];
  if(launch[@"SparkEditableEndpoint"])return @{@"kind":@"remote",@"endpoint":launch[@"SparkEditableEndpoint"],@"model":launch[@"SparkEditableModel"] ?: @""};
  return [defaults dictionaryForKey:@"SparkEditableProvider"] ?: self.manifest[@"editing"][@"provider"] ?: @{@"kind":@"remote",@"endpoint":[defaults stringForKey:@"SparkEditableEndpoint"] ?: @"https://api.openai.com/v1/chat/completions",@"model":[defaults stringForKey:@"SparkEditableModel"] ?: @""};
}
- (void)syncProviderFields {
  self.endpoint.enabled=self.providerChoice.indexOfSelectedItem>=2;self.key.enabled=self.providerChoice.indexOfSelectedItem==3;
}
- (void)providerChanged:(id)sender {
  [self syncProviderFields];self.model.stringValue=@"";
  self.endpoint.stringValue=self.providerChoice.indexOfSelectedItem==2 ? @"http://127.0.0.1:11434/v1/chat/completions" : @"https://api.openai.com/v1/chat/completions";
  self.message=self.providerChoice.indexOfSelectedItem<2 ? @"Uses the installed CLI and its existing login. No API key needed." : @"Choose a model supported by this endpoint.";self.status.stringValue=self.message;
}
- (NSDictionary *)panelProvider {
  NSInteger index=self.providerChoice.indexOfSelectedItem;
  NSMutableDictionary *provider=[NSMutableDictionary new];
  if(index<2){provider[@"kind"]=@"cli";provider[@"tool"]=index==0 ? @"codex" : @"claude";if(self.model.stringValue.length)provider[@"model"]=self.model.stringValue;}
  else{provider[@"kind"]=index==2 ? @"local" : @"remote";provider[@"endpoint"]=self.endpoint.stringValue;provider[@"model"]=self.model.stringValue;if(index==3)provider[@"apiKey"]=self.key.stringValue;}
  return provider;
}
- (void)configure:(NSDictionary *)value {
  NSDictionary *provider=SEProvider(value);
  if(value[@"apiKey"])[self credential:value[@"apiKey"]];
  [NSUserDefaults.standardUserDefaults setObject:provider forKey:@"SparkEditableProvider"];
  if(self.panel){[self.providerChoice selectItemAtIndex:[provider[@"kind"] isEqual:@"cli"] ? ([provider[@"tool"] isEqual:@"claude"] ? 1 : 0) : ([provider[@"kind"] isEqual:@"local"] ? 2 : 3)];self.endpoint.stringValue=provider[@"endpoint"] ?: @"";self.model.stringValue=provider[@"model"] ?: @"";self.key.stringValue=[provider[@"kind"] isEqual:@"remote"] ? [self credential:nil] : @"";[self syncProviderFields];}
}
- (NSString *)previousRelease {
  NSString *previous=nil;NSDate *newest=NSDate.distantPast;
  for(NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:[self.support stringByAppendingPathComponent:@"releases"] error:nil]) {
    if([name isEqual:self.manifest[@"release"]])continue;
    NSString *folder=[[self.support stringByAppendingPathComponent:@"releases"] stringByAppendingPathComponent:name];
    if(![SERead([folder stringByAppendingPathComponent:@"state.json"])[@"status"] isEqual:@"customized"])continue;
    NSDate *date=[[NSFileManager.defaultManager attributesOfItemAtPath:[folder stringByAppendingPathComponent:@"state.json"] error:nil] fileModificationDate];
    if(date && [date compare:newest]==NSOrderedDescending){newest=date;previous=folder;}
  }return previous;
}
- (NSDictionary *)state {
  return @{@"enabled":@(self.manifest.count>0),@"busy":@(self.busy),@"phase":self.phase ?: @"idle",@"message":self.message ?: @"",@"ready":@(SERead([self path:@"ready.json"]).count>0),@"customized":@(!self.forceOriginal && SERead([self path:@"active.json"]).count>0),@"previewing":@(self.previewRecord!=nil),@"migrationAvailable":@([self previousRelease]!=nil),@"provider":[self provider]};
}
- (void)emitState {
  self.status.stringValue=self.message;
  [NSNotificationCenter.defaultCenter postNotificationName:@"SparkDesktopEvent" object:nil userInfo:@{@"type":@"editingState",@"state":[self state]}];
}
- (void)perform:(NSString *)phase message:(NSString *)message block:(id (^)(void))block completion:(void (^)(id,NSException *))completion {
  if(self.busy){if(completion)completion(nil,[NSException exceptionWithName:@"E_BUSY" reason:@"An editing operation is already running" userInfo:nil]);return;}
  self.busy=YES;SECancelRequested=NO;self.phase=phase;self.message=message;[self emitState];
  for(NSButton *button in self.buttons)button.enabled=NO;self.buttons.firstObject.title=@"Cancel";self.buttons.firstObject.enabled=YES;
  self.providerChoice.enabled=NO;self.endpoint.enabled=NO;self.model.enabled=NO;self.key.enabled=NO;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
    id result;NSException *failure;
    @try { result=block(); } @catch(NSException *exception){failure=exception;}
    dispatch_async(dispatch_get_main_queue(), ^{
      self.busy=NO;self.phase=failure ? @"error" : @"idle";self.message=failure ? failure.reason : ([result isKindOfClass:NSString.class] ? result : @"Done. Review the candidate before applying it.");
      self.buttons.firstObject.title=@"Generate";for(NSButton *button in self.buttons)button.enabled=YES;self.providerChoice.enabled=YES;self.model.enabled=YES;[self syncProviderFields];[self emitState];
      if(completion)completion(result,failure);
    });
  });
}
- (void)operation:(NSString *)message block:(NSString *(^)(void))block {
  [self perform:@"preparing" message:message block:block completion:nil];
}
- (void)cancel {
  if(!self.busy)return;
  @synchronized(NSTask.class){SECancelRequested=YES;for(NSTask *task in SETasks)if(task.running)[task terminate];}
  self.message=@"Canceling; any generated candidate and prompt will be retained.";[self emitState];
}
- (NSString *)download:(NSDictionary *)asset kind:(NSString *)kind {
  if (!SEIdentifier(asset[@"sha256"], @"^[a-f0-9]{64}$") || !SEIdentifier(asset[@"url"], @"^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") || [asset[@"size"] longLongValue]<=0) @throw [NSException exceptionWithName:@"SparkEditable" reason:@"Invalid pinned download." userInfo:nil];
  NSString *cache=[[[self.support stringByDeletingLastPathComponent] stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Legend Spark/EditingToolkits"];
  [NSFileManager.defaultManager createDirectoryAtPath:cache withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil];
  NSString *target=[cache stringByAppendingPathComponent:asset[@"sha256"]];
  int fd=open([[target stringByAppendingString:@".lock"] fileSystemRepresentation], O_CREAT|O_RDWR,0600);
  if (fd<0 || flock(fd,LOCK_EX)) { if(fd>=0)close(fd); @throw [NSException exceptionWithName:@"SparkEditable" reason:@"Could not lock download cache." userInfo:nil]; }
  NSString *stage=[target stringByAppendingFormat:@".pending-%@",NSUUID.UUID.UUIDString];
  @try {
    if ([SERead([target stringByAppendingPathComponent:@"complete.json"])[@"sha256"] isEqual:asset[@"sha256"]]) return [target stringByAppendingPathComponent:kind];
    [NSFileManager.defaultManager createDirectoryAtPath:stage withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil];
    NSString *archive=[stage stringByAppendingPathComponent:@"download.tgz"];
    SERun(@"/usr/bin/curl",@[@"--fail",@"--location",@"--proto",@"=https",@"--proto-redir",@"=https",@"--connect-timeout",@"30",@"--max-time",@"1800",@"--max-filesize",[asset[@"size"] stringValue],@"--output",archive,asset[@"url"]],nil);
    NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:archive error:nil];
    if (![SEHash(archive) isEqual:asset[@"sha256"]] || [attributes fileSize] != [asset[@"size"] unsignedLongLongValue]) @throw [NSException exceptionWithName:@"SparkEditable" reason:@"Download checksum or size mismatch." userInfo:nil];
    SERun(@"/usr/bin/tar",@[@"-xzf",archive,@"-C",stage],nil);
    if (![NSFileManager.defaultManager fileExistsAtPath:[stage stringByAppendingPathComponent:kind]]) @throw [NSException exceptionWithName:@"SparkEditable" reason:@"Incomplete editing archive." userInfo:nil];
    [NSFileManager.defaultManager removeItemAtPath:archive error:nil]; SEWrite([stage stringByAppendingPathComponent:@"complete.json"],@{@"sha256":asset[@"sha256"]});
    [NSFileManager.defaultManager removeItemAtPath:target error:nil]; NSError *error;
    if (![NSFileManager.defaultManager moveItemAtPath:stage toPath:target error:&error]) @throw [NSException exceptionWithName:@"SparkEditable" reason:error.localizedDescription userInfo:nil];
    return [target stringByAppendingPathComponent:kind];
  } @finally { [NSFileManager.defaultManager removeItemAtPath:stage error:nil]; flock(fd,LOCK_UN);close(fd); }
}
- (NSString *)worker:(NSArray *)arguments key:(NSString *)key {
  NSMutableDictionary *env=[NSProcessInfo.processInfo.environment mutableCopy];
  env[@"PATH"]=SEPath();
  [env removeObjectForKey:@"SPARK_EDITABLE_AI_KEY"];
  env[@"SPARK_HOME"]=[[self.support stringByDeletingLastPathComponent].stringByDeletingLastPathComponent stringByAppendingPathComponent:@"Legend Spark"];
  if(key.length)env[@"SPARK_EDITABLE_AI_KEY"]=key;
  NSArray *args=[@[[self.toolkit stringByAppendingPathComponent:@"runtime-bootstrap.sh"],[self.toolkit stringByAppendingPathComponent:@"editable-worker.cjs"]] arrayByAddingObjectsFromArray:arguments];
  return SERun(@"/bin/sh",args,env);
}
- (void)prepare {
  self.toolkit=[self download:self.manifest[@"toolkit"] kind:@"toolkit"];
  {
    NSString *source=[NSFileManager.defaultManager fileExistsAtPath:[self path:@"state.json"]] ? [self path:@"base"] : [self download:self.manifest[@"source"] kind:@"source"];
    [self worker:@[@"prepare",[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"spark-editable.json"],source,self.toolkit,self.support] key:nil];
  }
}
- (BOOL)confirmAI:(NSDictionary *)provider {
  if([provider[@"kind"] isEqual:@"local"])return YES;
  NSString *identity=[provider[@"kind"] isEqual:@"cli"] ? [@"cli:" stringByAppendingString:provider[@"tool"]] : provider[@"endpoint"];
  if([[NSUserDefaults.standardUserDefaults stringForKey:@"SparkEditableConsentEndpoint"] isEqual:identity])return YES;
  NSAlert *alert=[NSAlert new];alert.messageText=@"Send this request to your AI provider?";
  alert.informativeText=@"The prompt, relevant app source, build diagnostics and, for migrations, previous prompts and patches are passed to the selected provider. Installed CLI tools use their existing login and may send this context to their cloud service. Changes remain separate until you apply them.";
  [alert addButtonWithTitle:@"Send request"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]!=NSAlertFirstButtonReturn)return NO;
  [NSUserDefaults.standardUserDefaults setObject:identity forKey:@"SparkEditableConsentEndpoint"];return YES;
}
- (NSDictionary *)generateRequest:(NSDictionary *)args {
  NSString *prompt=args[@"prompt"];
  if(![prompt isKindOfClass:NSString.class] || ![prompt stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length || prompt.length>32000)@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Enter a prompt of at most 32000 characters" userInfo:nil];
  NSDictionary *raw=args[@"provider"] ?: [self provider],*provider=SEProvider(raw);
  if(![provider[@"kind"] isEqual:@"local"] && ![args[@"allowSourceSharing"] isEqual:@YES])@throw [NSException exceptionWithName:@"E_PERMISSION" reason:@"Explain source sharing and obtain consent before generating edits" userInfo:nil];
  if([args[@"migration"] boolValue] && !SERead([self path:@"state.json"])[@"migration"])@throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Prepare an edit migration first" userInfo:nil];
  [self configure:raw];
  NSMutableDictionary *request=[provider mutableCopy];request[@"provider"]=request[@"kind"];[request removeObjectForKey:@"kind"];request[@"prompt"]=prompt;request[@"allowSourceSharing"]=@YES;request[@"migration"]=@([args[@"migration"] boolValue]);return request;
}
- (NSDictionary *)runPrompt:(NSDictionary *)request key:(NSString *)key {
  [self prepare];NSString *file=[self path:@"request.json"];SEWrite(file,request);
  @try { return SEResult([self worker:@[@"prompt",self.directory,file] key:key]); }
  @finally { [NSFileManager.defaultManager removeItemAtPath:file error:nil]; }
}
- (void)generate:(id)sender { if(self.busy){[self cancel];return;}[self generateMigration:NO]; }
- (void)generateMigration:(BOOL)migration {
  @try {
    NSDictionary *provider=[self panelProvider];if(![self confirmAI:provider])return;
    NSDictionary *request=[self generateRequest:@{@"prompt":self.prompt.string,@"provider":provider,@"allowSourceSharing":@YES,@"migration":@(migration)}];
    NSString *key=[provider[@"kind"] isEqual:@"remote"] ? [self credential:nil] : nil;
    [self perform:@"generating" message:@"Preparing tools and generating a separate candidate…" block:^id{[self runPrompt:request key:key];return @"Candidate compiled successfully. Review its prompt and changes before applying.";} completion:nil];
  } @catch(NSException *e){self.message=e.reason;[self emitState];}
}
- (NSDictionary *)prepareMigration {
  [self prepare];NSDictionary *migration=SERead([self path:@"state.json"])[@"migration"];
  if(!migration){NSString *previous=[self previousRelease];if(!previous)return @{@"status":@"none",@"conflicts":@[]};[self worker:@[@"migrate",previous,self.directory] key:nil];migration=SERead([self path:@"state.json"])[@"migration"];}
  if(![migration[@"conflicts"] count])[self worker:@[@"build",self.directory,migration[@"candidate"]] key:nil];return migration;
}
- (void)migrate:(id)sender {
  if(SERead([self path:@"state.json"])[@"migration"]) {
    if(!self.prompt.string.length)self.prompt.string=@"Preserve my previous customizations on this updated app. Use the saved prompts to understand their intent and resolve incompatibilities.";
    [self generateMigration:YES];return;
  }
  [self perform:@"migrating" message:@"Preparing migration from the previous customized release…" block:^id{
    NSDictionary *migration=[self prepareMigration];
    if([migration[@"status"] isEqual:@"none"])return @"No previous customized release was found.";
    if([migration[@"conflicts"] count])return @"Migration has conflicts. Enter a prompt and choose Migrate edits again to resolve them.";
    return @"Migration compiled. Review it and Apply, or enter a migration prompt for AI assistance.";
  } completion:nil];
}
- (NSDictionary *)editReview {
  NSString *text=[NSString stringWithContentsOfFile:[self path:@"review.txt"] encoding:NSUTF8StringEncoding error:nil] ?: @"";
  NSDictionary *state=SERead([self path:@"state.json"]);NSMutableArray *history=[NSMutableArray arrayWithArray:state[@"inheritedPrompts"] ?: @[]];[history addObjectsFromArray:state[@"history"] ?: @[]];
  // The full diff is already in text; avoid sending stored file contents twice over the bridge.
  NSMutableArray *prompts=[NSMutableArray new];
  for(NSDictionary *item in history){NSMutableDictionary *metadata=[NSMutableDictionary new];for(NSString *key in @[@"id",@"prompt",@"baseRelease",@"created",@"model",@"provider",@"providerKind",@"status",@"summary",@"error"])if(item[key])metadata[key]=item[key];[prompts addObject:metadata];}
  NSMutableDictionary *review=[@{@"text":text,@"prompts":prompts} mutableCopy];
  NSString *candidate=SERead([self path:@"ready.json"])[@"candidate"];if(candidate)review[@"candidate"]=candidate;return review;
}
- (void)review:(id)sender {
  NSString *content=[NSString stringWithContentsOfFile:[self path:@"review.txt"] encoding:NSUTF8StringEncoding error:nil];
  if(!content.length){self.status.stringValue=@"Generate or migrate a candidate to review changes.";return;}
  NSMutableString *history=[content mutableCopy];[history appendString:@"\n\nSaved prompts\n"];
  for(NSDictionary *item in SERead([self path:@"state.json"])[@"history"]){[history appendFormat:@"\n%@ — %@\n%@\n",item[@"created"] ?: @"",item[@"status"] ?: @"",item[@"prompt"] ?: @""];}
  content=history;
  if(!self.reviewWindow){self.reviewWindow=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];self.reviewWindow.releasedWhenClosed=NO;self.reviewWindow.title=@"Review customization";[self.reviewWindow center];}
  NSScrollView *scroll=[[NSScrollView alloc] initWithFrame:self.reviewWindow.contentView.bounds];scroll.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;scroll.hasVerticalScroller=YES;
  NSTextView *text=[[NSTextView alloc] initWithFrame:scroll.bounds];text.editable=NO;text.font=[NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];text.string=content;text.autoresizingMask=NSViewWidthSizable;text.textContainer.widthTracksTextView=YES;scroll.documentView=text;
  self.reviewWindow.contentView=scroll;[self.reviewWindow makeKeyAndOrderFront:nil];
}
- (void)activateCandidate:(BOOL)preview {
  [self prepare];[self worker:@[preview ? @"verify" : @"accept",self.directory] key:nil];NSDictionary *ready=SERead([self path:@"ready.json"]);
  SEWrite([self path:@"pending.json"],@{@"previous":SERead([self path:@"active.json"]),@"launched":@NO,@"activation":NSUUID.UUID.UUIDString});
  if(!preview)SEWrite([self path:@"active.json"],ready);
  dispatch_async(dispatch_get_main_queue(),^{self.previewRecord=preview ? ready : nil;self.forceOriginal=NO;self.started=NO;[self emitState];});
}
- (void)reload {
  // Let the bridge deliver completion before replacing the JS runtime.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,100*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[[NSNotificationCenter defaultCenter] postNotificationName:@"SparkEditableReload" object:nil];});
}
- (void)activate:(BOOL)preview {
  NSAlert *alert=[NSAlert new];alert.messageText=preview ? @"Preview this customization?" : @"Apply the reviewed customization?";alert.informativeText=@"The app will reload using your current data. Save your work first. Code changes can affect app data; reverting code does not undo data changes.";[alert addButtonWithTitle:preview ? @"Preview" : @"Apply and reload"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]!=NSAlertFirstButtonReturn)return;
  [self perform:preview ? @"previewing" : @"applying" message:@"Activating customization…" block:^id{[self activateCandidate:preview];return preview ? @"Previewing for this session. Apply to keep it, or choose Original." : @"Customization activated. The original remains available.";} completion:^(id result,NSException *error){if(!error)[self reload];}];
}
- (void)preview:(id)sender { [self activate:YES]; }
- (void)apply:(id)sender { [self activate:NO]; }
- (void)original:(id)sender {
  self.previewRecord=nil;self.forceOriginal=YES;[NSFileManager.defaultManager removeItemAtPath:[self path:@"active.json"] error:nil];[NSFileManager.defaultManager removeItemAtPath:[self path:@"pending.json"] error:nil];
  self.phase=@"idle";self.message=@"Using the original app. Your source, prompts and patches are preserved.";[self emitState];[self reload];
}
- (void)handleCall:(NSNotification *)note {
  if(!self.manifest.count)return;
  void (^claim)(void)=note.userInfo[@"claim"];claim();
  void (^reply)(NSString *,NSString *,NSString *)=note.userInfo[@"reply"];
  void (^done)(id,NSException *)=^(id result,NSException *error){
    if(error){reply(nil,[error.name hasPrefix:@"E_"] ? error.name : @"E_NATIVE",error.reason);return;}
    NSData *data=[NSJSONSerialization dataWithJSONObject:result ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];reply([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding],nil,nil);
  };
  NSString *method=note.userInfo[@"method"];NSDictionary *args=note.userInfo[@"args"];
  @try {
    if([method isEqual:@"state"]){done([self state],nil);return;}
    if([method isEqual:@"cancel"]){[self cancel];done(nil,nil);return;}
    if([method isEqual:@"show"]){[self show:nil];done(nil,nil);return;}
    if(self.busy)@throw [NSException exceptionWithName:@"E_BUSY" reason:@"An editing operation is already running" userInfo:nil];
    if([method isEqual:@"configure"]){[self configure:args[@"provider"]];[self emitState];done(nil,nil);}
    else if([method isEqual:@"review"])done([self editReview],nil);
    else if([method isEqual:@"prompt"]){NSDictionary *request=[self generateRequest:args];NSString *key=[request[@"provider"] isEqual:@"remote"] ? [self credential:nil] : nil;[self perform:@"generating" message:@"Generating customization…" block:^id{return [self runPrompt:request key:key];} completion:done];}
    else if([method isEqual:@"migrate"])[self perform:@"migrating" message:@"Preparing migration…" block:^id{return [self prepareMigration];} completion:done];
    else if([method isEqual:@"preview"] || [method isEqual:@"apply"]){BOOL preview=[method isEqual:@"preview"];[self perform:preview ? @"previewing" : @"applying" message:@"Activating customization…" block:^id{[self activateCandidate:preview];return nil;} completion:^(id result,NSException *error){done(result,error);if(!error)[self reload];}];}
    else if([method isEqual:@"original"]){[self original:nil];done(nil,nil);}
    else @throw [NSException exceptionWithName:@"E_INVALID_ARGUMENT" reason:@"Unknown editing operation" userInfo:nil];
  } @catch(NSException *error){done(nil,error);}
}
- (void)recoverActivation:(NSString *)activation {
  if([SERead([self path:@"pending.json"])[@"activation"] isEqual:activation]) { [self show:nil];[self original:nil];self.status.stringValue=@"The customization did not render within 30 seconds. Restored the original; your changes are preserved."; }
}
- (void)healthy:(NSNotification *)notification {
  if([notification.object isKindOfClass:NSView.class] && ![(NSView *)notification.object window])return;
  if(self.started && !self.forceOriginal) [NSFileManager.defaultManager removeItemAtPath:[self path:@"pending.json"] error:nil];
}
- (NSURL *)bundleURL {
  NSURL *original=[NSBundle.mainBundle URLForResource:@"main" withExtension:@"jsbundle"];
  if(self.forceOriginal)return original;
  if(!self.started) {
    NSDictionary *pending=SERead([self path:@"pending.json"]);
    if([pending[@"launched"] boolValue]) {SEWrite([self path:@"active.json"],pending[@"previous"] ?: @{});[NSFileManager.defaultManager removeItemAtPath:[self path:@"pending.json"] error:nil];}
    else if(pending.count) {
      NSString *activation=pending[@"activation"] ?: NSUUID.UUID.UUIDString;
      SEWrite([self path:@"pending.json"],@{@"previous":pending[@"previous"] ?: @{},@"launched":@YES,@"activation":activation});
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(),^{ [self recoverActivation:activation]; });
    }
    self.started=YES;
  }
  NSDictionary *active=self.previewRecord ?: SERead([self path:@"active.json"]);
  if(![active[@"release"] isEqual:self.manifest[@"release"]] || ![active[@"fingerprint"] isEqual:self.manifest[@"runtime"][@"fingerprint"]] || !SEIdentifier(active[@"build"],@"^[A-Fa-f0-9-]{36}$"))return original;
  NSString *file=[[[self path:@"builds"] stringByAppendingPathComponent:active[@"build"]] stringByAppendingPathComponent:@"main.jsbundle"];
  if(![SEHash(file) isEqual:active[@"bundleHash"]])return original;
  return [NSURL fileURLWithPath:file];
}
@end
static void SparkEditableStart(void) {
  if(SEController)return;SEController=[SparkEditableController new];
  if(!SEController.manifest.count)return;
  NSString *notice=[@"SparkEditableSeen-" stringByAppendingString:SEController.manifest[@"release"]];
  if(![SEController.manifest[@"editing"][@"ui"] isEqual:@"custom"] && ![NSUserDefaults.standardUserDefaults boolForKey:notice] && !SERead([SEController path:@"state.json"]).count) {
    for(NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:[SEController.support stringByAppendingPathComponent:@"releases"] error:nil]) {
      NSDictionary *state=SERead([[[SEController.support stringByAppendingPathComponent:@"releases"] stringByAppendingPathComponent:name] stringByAppendingPathComponent:@"state.json"]);
      if([state[@"status"] isEqual:@"customized"]) {
        dispatch_async(dispatch_get_main_queue(),^{[SEController show:nil];SEController.status.stringValue=@"This update is running the original app. Your previous changes and prompts are preserved. Choose Migrate edits to bring them forward.";});break;
      }
    }
    [NSUserDefaults.standardUserDefaults setBool:YES forKey:notice];
  }
}
static NSURL *SparkEditableBundleURL(void) { @try { SparkEditableStart();return [SEController bundleURL]; } @catch(NSException *exception) { return [NSBundle.mainBundle URLForResource:@"main" withExtension:@"jsbundle"]; } }
static NSMenu *SparkEditableDockMenu(NSMenu *existing) {
  SparkEditableStart(); NSMenu *menu=existing ? [existing copy] : [NSMenu new];
  if([SEController.manifest[@"editing"][@"ui"] isEqual:@"custom"])return menu;
  NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:@"Customize app…" action:@selector(show:) keyEquivalent:@""];
  item.target=SEController;[menu addItem:item];return menu;
}
