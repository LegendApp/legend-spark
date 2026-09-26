#import "RNDesktopProcesses.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <signal.h>
#import <AppKit/AppKit.h>
#import <spawn.h>
#import <sys/wait.h>
#import <vector>
static NSString *ResolveCommandPath(NSString *command)
{
  NSString *expandedCommand = [command stringByExpandingTildeInPath];
  if ([command hasPrefix:@"bundle:"]) {
    NSString *root = [[[NSBundle mainBundle] resourcePath] stringByResolvingSymlinksInPath];
    NSString *relative = [command substringFromIndex:7];
    NSString *candidate = [[[root stringByAppendingPathComponent:relative] stringByStandardizingPath] stringByResolvingSymlinksInPath];
    if ([candidate hasPrefix:[root stringByAppendingString:@"/"]] && [[NSFileManager defaultManager] isExecutableFileAtPath:candidate]) {
      return candidate;
    }
    return nil;
  }
  if ([expandedCommand containsString:@"/"]) {
    return [[NSFileManager defaultManager] isExecutableFileAtPath:expandedCommand] ? expandedCommand : nil;
  }

  NSString *homeDirectory = NSHomeDirectory();
  NSArray<NSString *> *fallbackPaths = @[
    [homeDirectory stringByAppendingPathComponent:@".local/bin"],
    [homeDirectory stringByAppendingPathComponent:@".bun/bin"],
    [homeDirectory stringByAppendingPathComponent:@"bin"],
    @"/opt/homebrew/bin",
    @"/usr/local/bin",
    @"/usr/bin",
    @"/bin",
    @"/usr/sbin",
    @"/sbin",
  ];
  NSMutableArray<NSString *> *searchPaths = [NSMutableArray array];
  NSString *pathValue = [[NSProcessInfo processInfo] environment][@"PATH"];
  if (pathValue.length > 0) {
    [searchPaths addObjectsFromArray:[pathValue componentsSeparatedByString:@":"]];
  }
  for (NSString *fallback in fallbackPaths) {
    if (![searchPaths containsObject:fallback]) {
      [searchPaths addObject:fallback];
    }
  }

  NSFileManager *fileManager = [NSFileManager defaultManager];
  for (NSString *directory in searchPaths) {
    NSString *candidate = [directory stringByAppendingPathComponent:command];
    if ([fileManager isExecutableFileAtPath:candidate]) {
      return candidate;
    }
  }

  return nil;
}

@interface SparkProcess : NSObject
@property pid_t pid;
@property BOOL running;
@property NSFileHandle *input;
@property BOOL timedOut;
@property BOOL truncated;
@property BOOL ended;
@property dispatch_queue_t inputQueue;
@end
@implementation SparkProcess
@end
@interface RNDesktopProcesses ()
@property NSMutableDictionary<NSString *, SparkProcess *> *processes;
@property BOOL invalidated;
@end
@implementation RNDesktopProcesses
RCT_EXPORT_MODULE(NativeDesktopProcesses)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init {
  if (self = [super init]) {
    _processes = [NSMutableDictionary new];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(stopAll) name:NSApplicationWillTerminateNotification object:nil];
  }
  return self;
}
- (void)stopAll { for (SparkProcess *process in self.processes.allValues) if (process.running) kill(-process.pid, SIGKILL); }
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }

- (void)terminate:(SparkProcess *)process {
  if (process.running) {
    kill(-process.pid, SIGTERM);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      if (process.running) kill(-process.pid, SIGKILL);
    });
  }
}

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json); NSString *key = args[@"id"];
    if (self.invalidated) { reject(@"E_CLOSED", @"Process module is closed", nil); return; }
    if ([method isEqual:@"resolveCommand"]) {
      NSString *command = args[@"command"];
      if (![command isKindOfClass:NSString.class] || !command.length) { SparkInvalid(reject, @"Expected a command name"); return; }
      resolve(SparkJSON(ResolveCommandPath(command) ?: (id)NSNull.null)); return;
    }
    SparkProcess *process = key ? self.processes[key] : nil;
    if ([method isEqual:@"spawn"]) {
      if (process) { reject(@"E_EXISTS", @"Process id already exists", nil); return; }
      NSString *executable = args[@"executable"];
      if ([executable hasPrefix:@"helper:"]) {
        NSString *name = [executable substringFromIndex:7];
        if (!name.length || [name rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"] invertedSet]].location != NSNotFound) { SparkInvalid(reject, @"Invalid helper name"); return; }
        NSString *helpers = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Helpers"];
        NSString *bundle = [helpers stringByAppendingPathComponent:[name stringByAppendingString:@".helper"]];
        executable = [helpers stringByAppendingPathComponent:name];
        if ([NSFileManager.defaultManager fileExistsAtPath:bundle]) {
          NSString *entry = [NSString stringWithContentsOfFile:[bundle stringByAppendingPathComponent:@".spark-entry"] encoding:NSUTF8StringEncoding error:nil];
          if (!entry.length || [entry hasPrefix:@"/"] || [entry containsString:@"\\"] || [[entry componentsSeparatedByString:@"/"] containsObject:@".."] || [entry containsString:@"\0"]) { SparkInvalid(reject, @"Invalid helper bundle entry"); return; }
          executable = [bundle stringByAppendingPathComponent:entry];
        }
      }
      if (![executable hasPrefix:@"/"]) { SparkInvalid(reject, @"Executable path must be absolute"); return; }
      process = [SparkProcess new];
      process.inputQueue = dispatch_queue_create("desktop.process.input", DISPATCH_QUEUE_SERIAL);
      NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy]; [environment addEntriesFromDictionary:args[@"env"] ?: @{}];
      NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe], *errorPipe = [NSPipe pipe];
      process.input = input.fileHandleForWriting;
      // Create the process group atomically, before executable code can fork.
      // NSTask + setpgid after launch has a race and cannot provide this contract.
      posix_spawnattr_t attributes; posix_spawnattr_init(&attributes);
      posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT);
      posix_spawnattr_setpgroup(&attributes, 0);
      posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
      posix_spawn_file_actions_adddup2(&actions, input.fileHandleForReading.fileDescriptor, STDIN_FILENO);
      posix_spawn_file_actions_adddup2(&actions, output.fileHandleForWriting.fileDescriptor, STDOUT_FILENO);
      posix_spawn_file_actions_adddup2(&actions, errorPipe.fileHandleForWriting.fileDescriptor, STDERR_FILENO);
      if (args[@"cwd"]) posix_spawn_file_actions_addchdir_np(&actions, [args[@"cwd"] fileSystemRepresentation]);
      NSArray *arguments = [@[executable] arrayByAddingObjectsFromArray:args[@"args"] ?: @[]];
      NSMutableArray *variables = [NSMutableArray new];
      for (NSString *name in environment) [variables addObject:[NSString stringWithFormat:@"%@=%@", name, environment[name]]];
      std::vector<char *> argv, envp;
      for (NSString *argument in arguments) argv.push_back((char *)argument.UTF8String); argv.push_back(nullptr);
      for (NSString *variable in variables) envp.push_back((char *)variable.UTF8String); envp.push_back(nullptr);
      pid_t pid = 0;
      int error = posix_spawn(&pid, executable.fileSystemRepresentation, &actions, &attributes, argv.data(), envp.data());
      posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes);
      [input.fileHandleForReading closeFile]; [output.fileHandleForWriting closeFile]; [errorPipe.fileHandleForWriting closeFile];
      if (error) { [process.input closeFile]; [output.fileHandleForReading closeFile]; [errorPipe.fileHandleForReading closeFile]; SparkReject(reject, [NSError errorWithDomain:NSPOSIXErrorDomain code:error userInfo:nil]); return; }
      process.pid = pid; process.running = YES;
      self.processes[key] = process;
      NSMutableData *stdoutData = [NSMutableData new], *stderrData = [NSMutableData new];
      dispatch_group_t group = dispatch_group_create();
      NSArray *streams = @[output.fileHandleForReading, errorPipe.fileHandleForReading];
      for (NSUInteger index = 0; index < streams.count; index++) {
        NSFileHandle *handle = streams[index]; NSMutableData *buffer = index ? stderrData : stdoutData;
        NSString *stream = index ? @"stderr" : @"stdout";
        dispatch_group_async(group, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
          @try {
            while (YES) {
              // readDataOfLength can wait for the requested length. A service's
              // short readiness/response message must be delivered before EOF.
              char bytes[16384]; ssize_t count;
              do { count = read(handle.fileDescriptor, bytes, sizeof(bytes)); } while (count < 0 && errno == EINTR);
              if (count <= 0) break;
              NSData *data = [NSData dataWithBytes:bytes length:(NSUInteger)count];
              @synchronized(process) { NSUInteger remaining = 8 * 1024 * 1024 - buffer.length; if (data.length > remaining) process.truncated = YES; [buffer appendData:[data subdataWithRange:NSMakeRange(0, MIN(remaining, data.length))]]; }
              if ([args[@"streamOutput"] boolValue]) dispatch_sync(dispatch_get_main_queue(), ^{ if (!self.invalidated) SparkEmit(@{ @"type": @"processOutput", @"processId": key, @"stream": stream, @"base64": [data base64EncodedStringWithOptions:0] }); });
            }
          } @catch (NSException *exception) { /* Closing the runtime interrupts pipe reads. */ }
          [handle closeFile];
        });
      }
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        int status = 0; while (waitpid(process.pid, &status, 0) < 0 && errno == EINTR) {}
        dispatch_sync(dispatch_get_main_queue(), ^{
          // Descendants must not keep the output pipes (and exited promise) alive.
          kill(-process.pid, SIGKILL); process.running = NO;
        });
        dispatch_group_notify(group, dispatch_get_main_queue(), ^{
          int terminationStatus = status;
          process.ended = YES;
          dispatch_async(process.inputQueue, ^{ @try { [process.input closeFile]; } @catch (NSException *exception) {} });
          if (!self.invalidated) SparkEmit(@{ @"type": @"processExit", @"processId": key, @"result": @{
            @"exitCode": @(WIFEXITED(terminationStatus) ? WEXITSTATUS(terminationStatus) : WTERMSIG(terminationStatus)), @"signal": @(WIFSIGNALED(terminationStatus)),
            @"stdout": [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding] ?: @"", @"stderr": [[NSString alloc] initWithData:stderrData encoding:NSUTF8StringEncoding] ?: @"",
            @"stdoutBase64": [stdoutData base64EncodedStringWithOptions:0], @"stderrBase64": [stderrData base64EncodedStringWithOptions:0],
            @"timedOut": @(process.timedOut), @"outputTruncated": @(process.truncated) } });
          [self.processes removeObjectForKey:key];
        });
      });
      if (args[@"input"]) { NSData *data = [args[@"input"] dataUsingEncoding:NSUTF8StringEncoding]; dispatch_async(process.inputQueue, ^{ @try { [process.input writeData:data]; } @catch (NSException *exception) {} }); }
      if (args[@"timeoutMs"]) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, [args[@"timeoutMs"] doubleValue] * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        if (process.running) { process.timedOut = YES; [self terminate:process]; }
      });
    } else {
      if (!process || process.ended) { if ([method isEqual:@"terminate"] || [method isEqual:@"closeInput"]) { resolve(@"null"); return; } reject(@"E_CLOSED", @"Process has exited", nil); return; }
      if ([method isEqual:@"terminate"]) [self terminate:process];
      else if ([method isEqual:@"write"] || [method isEqual:@"closeInput"]) {
        dispatch_async(process.inputQueue, ^{
          @try { if ([method isEqual:@"write"]) [process.input writeData:[args[@"text"] dataUsingEncoding:NSUTF8StringEncoding]]; else [process.input closeFile]; resolve(@"null"); }
          @catch (NSException *exception) { reject(@"E_PIPE", @"Process input is closed", nil); }
        }); return;
      } else { SparkInvalid(reject, @"Unknown process operation"); return; }
    }
    resolve(@"null");
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ self.invalidated = YES; [self stopAll]; }); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopProcessesSpecJSI>(params); }
@end
