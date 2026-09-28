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
static NSString *SERun(NSString *executable, NSArray *arguments, NSDictionary *environment) {
  NSTask *task = [NSTask new]; task.executableURL = [NSURL fileURLWithPath:executable]; task.arguments = arguments;
  if (environment) task.environment = environment;
  NSPipe *pipe = [NSPipe pipe]; task.standardOutput = pipe; task.standardError = pipe;
  NSError *error; if (![task launchAndReturnError:&error]) @throw [NSException exceptionWithName:@"SparkEditable" reason:error.localizedDescription userInfo:nil];
  @synchronized(NSTask.class) { if(!SETasks)SETasks=[NSMutableSet new]; [SETasks addObject:task]; }
  NSData *data = [pipe.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
  @synchronized(NSTask.class) { [SETasks removeObject:task]; }
  NSString *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
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
    _forceOriginal = [NSProcessInfo.processInfo.arguments containsObject:@"--spark-original"] || ([NSEvent modifierFlags] & NSEventModifierFlagOption);
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification object:nil queue:nil usingBlock:^(NSNotification *note) { @synchronized(NSTask.class) { for(NSTask *task in SETasks) if(task.running)[task terminate]; } }];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(healthy:) name:@"RCTContentDidAppearNotification" object:nil];
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
      if ((event.modifierFlags & (NSEventModifierFlagCommand|NSEventModifierFlagShift)) == (NSEventModifierFlagCommand|NSEventModifierFlagShift) && [event.charactersIgnoringModifiers.lowercaseString isEqual:@"e"]) { [self show:nil]; return nil; }
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
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSArray *labels = @[@"API endpoint", @"Model", @"API key"];
    self.endpoint = [[NSTextField alloc] initWithFrame:NSMakeRect(130,292,530,26)]; self.endpoint.stringValue = [defaults stringForKey:@"SparkEditableEndpoint"] ?: @"https://api.openai.com/v1/chat/completions";
    self.model = [[NSTextField alloc] initWithFrame:NSMakeRect(130,256,530,26)]; self.model.stringValue = [defaults stringForKey:@"SparkEditableModel"] ?: @""; self.model.placeholderString = @"Model identifier from your provider";
    self.key = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(130,220,530,26)]; self.key.placeholderString = @"Stored securely in Keychain"; self.key.stringValue = [self credential:nil];
    NSArray *fields = @[self.endpoint,self.model,self.key];
    for (NSUInteger i=0;i<3;i++) { NSTextField *label=[NSTextField labelWithString:labels[i]]; label.frame=NSMakeRect(20,296-36*i,105,20); [view addSubview:label]; [view addSubview:fields[i]]; }
    self.buttons = [NSMutableArray new];
    NSArray *titles = @[@"Generate",@"Migrate edits",@"Review",@"Preview",@"Apply",@"Original"];
    NSArray *selectors = @[@"generate:",@"migrate:",@"review:",@"preview:",@"apply:",@"original:"];
    for (NSUInteger i=0;i<titles.count;i++) {
      NSButton *button = [NSButton buttonWithTitle:titles[i] target:self action:NSSelectorFromString(selectors[i])]; button.frame=NSMakeRect(20+(i%3)*215,165-(i/3)*40,205,32); [view addSubview:button]; [self.buttons addObject:button];
    }
    self.status = [NSTextField wrappingLabelWithString:@"Tools download on first use. AI requests send relevant source to your chosen provider and may incur charges. Hold Option at launch to use the original app."];
    long long bytes=[self.manifest[@"source"][@"size"] longLongValue]+[self.manifest[@"toolkit"][@"size"] longLongValue];
    if(bytes>0)self.status.stringValue=[NSString stringWithFormat:@"First-use source and tools: %@, plus Bun if needed. AI sends relevant source to your chosen provider. Hold Option at launch for the original app.",[NSByteCountFormatter stringFromByteCount:bytes countStyle:NSByteCountFormatterCountStyleFile]];
    self.status.frame=NSMakeRect(20,20,640,85); [view addSubview:self.status]; [self.panel center];
  }
  [self.panel makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
}
- (void)operation:(NSString *)message block:(NSString *(^)(void))block {
  if (self.busy) return; self.busy=YES; self.status.stringValue=message;
  for (NSButton *button in self.buttons) button.enabled=NO;
  self.buttons.firstObject.title=@"Cancel";self.buttons.firstObject.enabled=YES;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
    NSString *result;
    @try { result=block(); } @catch (NSException *exception) { result=exception.reason; }
    dispatch_async(dispatch_get_main_queue(), ^{ self.busy=NO; self.buttons.firstObject.title=@"Generate"; for (NSButton *button in self.buttons) button.enabled=YES; self.status.stringValue=result ?: @"Done"; });
  });
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
  env[@"PATH"]=[NSString stringWithFormat:@"%@/.bun/bin:/opt/homebrew/bin:/usr/local/bin:%@",NSHomeDirectory(),env[@"PATH"] ?: @"/usr/bin:/bin:/usr/sbin:/sbin"];
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
- (BOOL)confirmAI {
  if([[NSUserDefaults.standardUserDefaults stringForKey:@"SparkEditableConsentEndpoint"] isEqual:self.endpoint.stringValue])return YES;
  NSAlert *alert=[NSAlert new]; alert.messageText=@"Send this request to your AI provider?";
  alert.informativeText=@"The prompt, relevant app source, build diagnostics and, for migrations, previous prompts and patches will be sent to the configured endpoint. Your provider may charge for usage. Changes remain separate until you apply them.";
  [alert addButtonWithTitle:@"Send request"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]!=NSAlertFirstButtonReturn)return NO;
  [NSUserDefaults.standardUserDefaults setObject:self.endpoint.stringValue forKey:@"SparkEditableConsentEndpoint"];
  return YES;
}
- (void)generate:(id)sender {
  if(self.busy){@synchronized(NSTask.class){for(NSTask *task in SETasks)if(task.running)[task terminate];}self.status.stringValue=@"Canceling; any generated candidate and prompt will be retained.";return;}
  [self generateMigration:NO];
}
- (void)generateMigration:(BOOL)migration {
  if(!self.prompt.string.length || !self.model.stringValue.length) { self.status.stringValue=@"Enter a prompt and provider model.";return; }
  if(![self confirmAI]){self.status.stringValue=@"Request canceled. No source was sent and no changes were applied.";return;}
  NSString *key=self.key.stringValue;
  @try { [self credential:key]; } @catch(NSException *e) {self.status.stringValue=e.reason;return;}
  [NSUserDefaults.standardUserDefaults setObject:self.endpoint.stringValue forKey:@"SparkEditableEndpoint"];
  [NSUserDefaults.standardUserDefaults setObject:self.model.stringValue forKey:@"SparkEditableModel"];
  NSDictionary *request=@{@"prompt":self.prompt.string,@"model":self.model.stringValue,@"endpoint":self.endpoint.stringValue,@"allowSourceSharing":@YES,@"migration":@(migration)};
  [self operation:@"Preparing tools and generating a separate candidate…" block:^NSString *{
    [self prepare];NSString *file=[self path:@"request.json"]; SEWrite(file,request);
    @try { [self worker:@[@"prompt",self.directory,file] key:key]; } @finally { [NSFileManager.defaultManager removeItemAtPath:file error:nil]; }
    return @"Candidate compiled successfully. Use Review to inspect its prompt and changes, then Apply when ready.";
  }];
}
- (void)migrate:(id)sender {
  if(SERead([self path:@"state.json"])[@"migration"]) {
    if(!self.prompt.string.length)self.prompt.string=@"Preserve my previous customizations on this updated app. Use the saved prompts to understand their intent and resolve incompatibilities.";
    [self generateMigration:YES]; return;
  }
  [self operation:@"Preparing migration from the previous customized release…" block:^NSString *{
    [self prepare]; NSString *releases=[self.support stringByAppendingPathComponent:@"releases"],*previous=nil; NSDate *newest=NSDate.distantPast;
    for(NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:releases error:nil]) {
      if([name isEqual:self.manifest[@"release"]])continue;
      NSString *folder=[releases stringByAppendingPathComponent:name];NSDictionary *state=SERead([folder stringByAppendingPathComponent:@"state.json"]);
      if(![state[@"status"] isEqual:@"customized"])continue;
      NSDate *date=[[NSFileManager.defaultManager attributesOfItemAtPath:[folder stringByAppendingPathComponent:@"state.json"] error:nil] fileModificationDate];
      if([date compare:newest]==NSOrderedDescending){newest=date;previous=folder;}
    }
    if(!previous) return @"No previous customized release was found. Your current source is unchanged.";
    [self worker:@[@"migrate",previous,self.directory] key:nil];
    NSDictionary *migration=SERead([self path:@"state.json"])[@"migration"];
    if([migration[@"conflicts"] count])return @"Migration has conflicts. Enter a migration prompt and choose Migrate edits again to ask AI to resolve them.";
    [self worker:@[@"build",self.directory,migration[@"candidate"]] key:nil];
    return @"Migration compiled. Review it and Apply, or enter a prompt and choose Migrate edits again for AI assistance.";
  }];
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
- (void)preview:(id)sender {
  if(!SERead([self path:@"ready.json"]).count){self.status.stringValue=@"Generate or migrate a candidate first.";return;}
  NSAlert *alert=[NSAlert new];alert.messageText=@"Preview this customization?";alert.informativeText=@"The app will reload with the candidate for this session. Save your work first. Preview uses your current app data; it can change that data. Restart or choose Original to leave preview.";[alert addButtonWithTitle:@"Preview"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]!=NSAlertFirstButtonReturn)return;
  [self operation:@"Preparing preview…" block:^NSString *{
    [self prepare];[self worker:@[@"verify",self.directory] key:nil];NSDictionary *ready=SERead([self path:@"ready.json"]);
    SEWrite([self path:@"pending.json"],@{@"previous":SERead([self path:@"active.json"]),@"launched":@NO,@"activation":NSUUID.UUID.UUIDString});
    dispatch_async(dispatch_get_main_queue(),^{self.previewRecord=ready;self.forceOriginal=NO;self.started=NO;[[NSNotificationCenter defaultCenter] postNotificationName:@"SparkEditableReload" object:nil];});
    return @"Previewing this candidate for this session. Apply to keep it, or Original to return to the shipped app.";
  }];
}
- (void)apply:(id)sender {
  if(!SERead([self path:@"ready.json"]).count){self.status.stringValue=@"Generate or migrate a candidate first.";return;}
  NSAlert *alert=[NSAlert new];alert.messageText=@"Apply the reviewed customization?";alert.informativeText=@"The app will reload. Save your work first. Code changes can affect app data; reverting code does not undo data changes.";[alert addButtonWithTitle:@"Apply and reload"];[alert addButtonWithTitle:@"Cancel"];
  if([alert runModal]!=NSAlertFirstButtonReturn)return;
  [self operation:@"Activating reviewed customization…" block:^NSString *{
    [self prepare];[self worker:@[@"accept",self.directory] key:nil];NSDictionary *ready=SERead([self path:@"ready.json"]),*previous=SERead([self path:@"active.json"]);
    SEWrite([self path:@"pending.json"],@{@"previous":previous,@"launched":@NO,@"activation":NSUUID.UUID.UUIDString});SEWrite([self path:@"active.json"],ready);
    dispatch_async(dispatch_get_main_queue(),^{self.previewRecord=nil;self.forceOriginal=NO;self.started=NO; [[NSNotificationCenter defaultCenter] postNotificationName:@"SparkEditableReload" object:nil];});
    return @"Customization activated. The original remains available.";
  }];
}
- (void)original:(id)sender {
  self.previewRecord=nil;self.forceOriginal=YES;[NSFileManager.defaultManager removeItemAtPath:[self path:@"active.json"] error:nil];[NSFileManager.defaultManager removeItemAtPath:[self path:@"pending.json"] error:nil];
  [[NSNotificationCenter defaultCenter] postNotificationName:@"SparkEditableReload" object:nil];self.status.stringValue=@"Using the original app. Your source, prompts and patches are preserved.";
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
  if(![NSUserDefaults.standardUserDefaults boolForKey:notice] && !SERead([SEController path:@"state.json"]).count) {
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
  NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:@"Customize app…" action:@selector(show:) keyEquivalent:@""];
  item.target=SEController;[menu addItem:item];return menu;
}
