#import "RNDesktopFileSystem.h"
#import <RNDesktopApp/SparkBinaryJSI.h>
#import <AppKit/AppKit.h>
#import "SparkFileMutations.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <fcntl.h>
#import <unistd.h>
#import <stdlib.h>
#import <sys/stat.h>
#import <errno.h>
#import <math.h>
#import <CoreServices/CoreServices.h>

@interface SparkRecursiveWatch : NSObject
@property FSEventStreamRef stream;
@property NSString *path;
@property (copy) void (^changed)(void);
- (void)stop;
@end
@implementation SparkRecursiveWatch
- (void)stop { if (_stream) { FSEventStreamStop(_stream); FSEventStreamInvalidate(_stream); FSEventStreamRelease(_stream); _stream = NULL; } }
- (void)dealloc { [self stop]; }
@end
static void RecursiveChanges(ConstFSEventStreamRef stream, void *info, size_t count, void *paths, const FSEventStreamEventFlags flags[], const FSEventStreamEventId ids[]) {
  SparkRecursiveWatch *watch = (__bridge SparkRecursiveWatch *)info;
  NSArray *changed = (__bridge NSArray *)paths;
  for (NSUInteger i = 0; i < count; i++) {
    NSString *path = changed[i];
    if ([watch.path isEqual:@"/"] || (flags[i] & (kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagRootChanged)) || [path isEqual:watch.path] || [path hasPrefix:[watch.path stringByAppendingString:@"/"]] || [watch.path hasPrefix:[path stringByAppendingString:@"/"]]) { watch.changed(); break; }
  }
}

@interface SparkOpenFile : NSObject
@property int descriptor;
@end
@implementation SparkOpenFile
- (instancetype)init { if (self = [super init]) _descriptor = -1; return self; }
- (void)dealloc { if (_descriptor >= 0) close(_descriptor); }
@end

@interface RNDesktopFileSystem ()
@property dispatch_queue_t ioQueue;
@property NSMutableDictionary<NSString *, SparkOpenFile *> *files;
@property NSMutableDictionary<NSString *, dispatch_source_t> *watches;
@property NSMutableDictionary<NSString *, SparkRecursiveWatch *> *recursiveWatches;
@end
static NSURL *FileURL(id value) {
  if (![value isKindOfClass:NSString.class] || ![value length]) return nil;
  if ([value hasPrefix:@"file://"]) return [NSURL URLWithString:value];
  return [value hasPrefix:@"/"] ? [NSURL fileURLWithPath:value] : nil;
}
@implementation RNDesktopFileSystem
RCT_EXPORT_MODULE(NativeDesktopFileSystem)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if (self = [super init]) { _ioQueue = dispatch_queue_create("spark.files", DISPATCH_QUEUE_SERIAL); _files = [NSMutableDictionary new]; _watches = [NSMutableDictionary new]; _recursiveWatches = [NSMutableDictionary new]; } return self; }
- (NSArray<NSString *> *)supportedEvents { return @[@"change"]; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { [self perform:method args:SparkArgs(json) binary:NO resolve:resolve reject:reject]; }
- (void)binaryCall:(NSString *)method args:(NSString *)json bytes:(NSData *)bytes resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { NSMutableDictionary *args = [SparkArgs(json) mutableCopy]; if (bytes) args[@"bytes"] = bytes; [self perform:method args:args binary:YES resolve:resolve reject:reject]; }
- (void)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(self.ioQueue, ^{
    NSFileManager *fm = NSFileManager.defaultManager;
    NSError *error = nil; id result = NSNull.null;
    if ([@[@"readChunk", @"writeChunk", @"flushFile", @"closeFile"] containsObject:method]) {
      NSString *identifier = args[@"id"]; SparkOpenFile *file = self.files[identifier];
      if ([method isEqual:@"closeFile"]) { [self.files removeObjectForKey:identifier]; resolve(binary ? NSNull.null : @"null"); return; }
      if (!file) { reject(@"E_CLOSED", @"Unknown or closed file handle", nil); return; }
      if ([method isEqual:@"flushFile"]) { if (fsync(file.descriptor)) error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil]; }
      else {
        double position = [args[@"offset"] doubleValue];
        if (![args[@"offset"] isKindOfClass:NSNumber.class] || !isfinite(position) || position < 0 || floor(position) != position || position > 9007199254740991.0) { SparkInvalid(reject, @"Invalid file offset"); return; }
        if ([method isEqual:@"readChunk"]) {
          double size = [args[@"length"] doubleValue];
          if (!isfinite(size) || size < 1 || size > 1048576 || floor(size) != size || position + size > 9007199254740991.0) { SparkInvalid(reject, @"Invalid chunk length"); return; }
          NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)size]; ssize_t count;
          do { count = pread(file.descriptor, data.mutableBytes, data.length, (off_t)position); } while (count < 0 && errno == EINTR);
          if (count < 0) error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
          else { data.length = count; result = data; }
        } else {
          NSData *data = args[@"bytes"];
          if (!data || data.length > 1048576 || position + data.length > 9007199254740991.0) { SparkInvalid(reject, @"Invalid chunk"); return; }
          NSUInteger written = 0;
          while (written < data.length) {
            ssize_t count = pwrite(file.descriptor, (const char *)data.bytes + written, data.length - written, (off_t)position + written);
            if (count < 0 && errno == EINTR) continue;
            if (count <= 0) { error = [NSError errorWithDomain:NSPOSIXErrorDomain code:count < 0 ? errno : EIO userInfo:nil]; break; }
            written += count;
          }
          result = @(written);
        }
      }
    } else if ([method isEqual:@"directory"]) {
      NSString *kind = args[@"kind"];
      NSURL *base;
      if ([kind isEqual:@"data"]) base = [fm URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:&error];
      else if ([kind isEqual:@"cache"]) base = [fm URLForDirectory:NSCachesDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:&error];
      else if ([kind isEqual:@"temp"]) base = [NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES];
      else { SparkInvalid(reject, @"Unknown directory kind"); return; }
      NSURL *url = [base URLByAppendingPathComponent:SparkNamespace() isDirectory:YES];
      if (!error) [fm createDirectoryAtURL:url withIntermediateDirectories:YES attributes:nil error:&error];
      result = url.path;
    } else if ([method isEqual:@"unwatch"]) {
      [self.recursiveWatches[args[@"id"]] stop]; [self.recursiveWatches removeObjectForKey:args[@"id"]];
      dispatch_source_t source = self.watches[args[@"id"]];
      if (source) { dispatch_source_cancel(source); [self.watches removeObjectForKey:args[@"id"]]; }
    } else {
      NSURL *url = FileURL(args[@"path"]);
      if (!url || !url.isFileURL || (url.host.length && ![url.host isEqual:@"localhost"])) { SparkInvalid(reject, @"Expected an absolute local path or file URL"); return; }
      if ([method isEqual:@"openFile"]) {
        NSString *mode = args[@"mode"]; int flags;
        if ([mode isEqual:@"read"]) flags = O_RDONLY;
        else if ([mode isEqual:@"readWrite"]) flags = O_RDWR;
        else if ([mode isEqual:@"write"]) flags = O_WRONLY | O_CREAT;
        else if ([mode isEqual:@"createNew"]) flags = O_WRONLY | O_CREAT | O_EXCL;
        else { SparkInvalid(reject, @"Invalid file mode"); return; }
        int fd = open(url.fileSystemRepresentation, flags | O_CLOEXEC | O_NONBLOCK, 0666);
        if (fd < 0) error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
        else {
          struct stat info; int code = 0;
          if (fstat(fd, &info)) code = errno;
          else if (!S_ISREG(info.st_mode)) code = EINVAL;
          else if ([mode isEqual:@"write"] && ftruncate(fd, 0)) code = errno;
          if (code) { close(fd); error = [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil]; }
          else { SparkOpenFile *file = [SparkOpenFile new]; file.descriptor = fd; NSString *identifier = NSUUID.UUID.UUIDString; self.files[identifier] = file; result = identifier; }
        }
      } else if ([method isEqual:@"trash"]) { [fm trashItemAtURL:url resultingItemURL:nil error:&error]; }
      else if ([method isEqual:@"readText"]) result = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:&error];
      else if ([method isEqual:@"readBytes"]) {
        NSMutableData *data = [NSMutableData dataWithContentsOfURL:url options:0 error:&error];
        result = data;
      }
      else if ([method isEqual:@"reveal"]) {
        if (![fm attributesOfItemAtPath:url.path error:&error]) { SparkReject(reject, error); return; }
        dispatch_async(dispatch_get_main_queue(), ^{
          [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[url]];
          resolve(binary ? NSNull.null : @"null");
        });
        return;
      }
      else if ([method isEqual:@"writeTextIfUnchanged"]) {
        result = @(SparkWriteTextIfUnchanged(url, args[@"expected"], args[@"text"], &error));
      }
      else if ([method isEqual:@"writeText"]) [args[@"text"] writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:&error];
      else if ([method isEqual:@"writeBytes"]) {
        NSData *data = args[@"bytes"];
        if (!data) { SparkInvalid(reject, @"Expected binary file data"); return; }
        [data writeToURL:url options:NSDataWritingAtomic error:&error];
      }
      else if ([method isEqual:@"mkdir"]) [fm createDirectoryAtURL:url withIntermediateDirectories:[args[@"recursive"] boolValue] attributes:nil error:&error];
      else if ([method isEqual:@"remove"]) {
        result = @(SparkRemoveFile(url, [args[@"recursive"] boolValue], &error));
        if ([error.domain isEqual:NSPOSIXErrorDomain] && error.code == ENOTEMPTY) {
          reject(@"E_NOT_EMPTY", @"Directory is not empty; pass recursive: true", error); return;
        }
      }
      else if ([method isEqual:@"copy"] || [method isEqual:@"move"]) {
        NSURL *to = FileURL(args[@"to"]);
        if (!to || !to.isFileURL || (to.host.length && ![to.host isEqual:@"localhost"])) { SparkInvalid(reject, @"Expected an absolute destination"); return; }
        SparkTransferPath(url, to, [method isEqual:@"copy"] ? SparkTransferCopy : SparkTransferMove, [args[@"overwrite"] boolValue], &error);
      }
      else if ([method isEqual:@"stat"]) {
        NSDictionary *attrs = [fm attributesOfItemAtPath:url.path error:&error];
        if (attrs) result = @{ @"size": attrs[NSFileSize], @"modifiedAt": @([attrs[NSFileModificationDate] timeIntervalSince1970] * 1000),
          @"type": [attrs[NSFileType] isEqual:NSFileTypeDirectory] ? @"directory" : [attrs[NSFileType] isEqual:NSFileTypeSymbolicLink] ? @"symlink" : @"file" };
      }
      else if ([method isEqual:@"list"]) {
        NSArray *names = [fm contentsOfDirectoryAtPath:url.path error:&error];
        result = [names sortedArrayUsingSelector:@selector(compare:)];
      }
      else if ([method isEqual:@"watch"]) {
        NSString *watchID = args[@"id"];
        if (self.watches[watchID] || self.recursiveWatches[watchID]) { SparkInvalid(reject, @"Watch id already exists"); return; }
        if ([args[@"recursive"] boolValue]) {
          BOOL directory = NO;
          if (![fm fileExistsAtPath:url.path isDirectory:&directory] || !directory) { SparkInvalid(reject, @"Recursive watch requires an existing directory"); return; }
          SparkRecursiveWatch *watch = [SparkRecursiveWatch new];
          // Keep real filesystem paths: Foundation can strip /private while a path
          // exists, then preserve it after deletion, breaking event comparisons.
          char *resolved = realpath(url.fileSystemRepresentation, NULL);
          if (!resolved) { SparkReject(reject, [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil]); return; }
          watch.path = [NSString stringWithUTF8String:resolved]; free(resolved);
          __weak RNDesktopFileSystem *weakSelf = self;
          watch.changed = ^{ [weakSelf sendEventWithName:@"change" body:@{ @"id": watchID, @"path": url.path }]; };
          FSEventStreamContext context = {0, (__bridge void *)watch, NULL, NULL, NULL};
          // Observe the parent too, keeping deletion/replacement of the root visible.
          NSArray *roots = @[[watch.path stringByDeletingLastPathComponent]];
          watch.stream = FSEventStreamCreate(NULL, RecursiveChanges, &context, (__bridge CFArrayRef)roots, kFSEventStreamEventIdSinceNow, 0.05,
            kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer);
          if (!watch.stream) { reject(@"E_WATCH", @"Could not create directory watcher", nil); return; }
          FSEventStreamSetDispatchQueue(watch.stream, self.ioQueue);
          if (!FSEventStreamStart(watch.stream)) { [watch stop]; reject(@"E_WATCH", @"Could not start directory watcher", nil); return; }
          self.recursiveWatches[watchID] = watch; resolve(binary ? NSNull.null : @"null"); return;
        }
        // Observe the parent so replacing a file atomically does not lose its watch.
        BOOL isDirectory = NO;
        [fm fileExistsAtPath:url.path isDirectory:&isDirectory];
        NSURL *observed = isDirectory ? url : [url URLByDeletingLastPathComponent];
        int fd = open(observed.fileSystemRepresentation, O_EVTONLY);
        if (fd < 0) { SparkReject(reject, [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil]); return; }
        dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_VNODE, fd,
          DISPATCH_VNODE_WRITE | DISPATCH_VNODE_DELETE | DISPATCH_VNODE_RENAME | DISPATCH_VNODE_EXTEND | DISPATCH_VNODE_ATTRIB,
          self.ioQueue);
        __weak RNDesktopFileSystem *weakSelf = self;
        dispatch_source_set_event_handler(source, ^{
          RNDesktopFileSystem *strongSelf = weakSelf;
          if (strongSelf) [strongSelf sendEventWithName:@"change" body:@{ @"id": watchID, @"path": url.path }];
        });
        dispatch_source_set_cancel_handler(source, ^{ close(fd); });
        self.watches[watchID] = source; dispatch_resume(source);
      }
      else { SparkInvalid(reject, @"Unknown filesystem operation"); return; }
    }
    if (error) SparkReject(reject, error); else resolve(binary ? result : SparkJSON(result));
  });
}
- (void)invalidate {
  dispatch_async(self.ioQueue, ^{ [self.files removeAllObjects]; for (SparkRecursiveWatch *watch in self.recursiveWatches.allValues) [watch stop]; [self.recursiveWatches removeAllObjects]; for (dispatch_source_t source in self.watches.allValues) dispatch_source_cancel(source); [self.watches removeAllObjects]; });
  [super invalidate];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<spark::binary::Module<facebook::react::NativeDesktopFileSystemSpecJSI>>(params);
}
@end
