#import "SparkLogging.h"
#if __has_include(<RNDesktopApp/SparkDesktopError.h>)
#import <RNDesktopApp/SparkDesktopError.h>
#else
#import "SparkDesktopError.h" // tests/logging.native.mm
#endif
#import <atomic>
#import <fcntl.h>
#import <os/log.h>
#import <sys/stat.h>
#import <sys/sysctl.h>
#import <unistd.h>

static NSString *const SparkLogCodeKey = @"SparkCode";
static NSError *SparkPosixError(int code, NSString *path) {
  return [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:@{
    NSFilePathErrorKey: path, NSLocalizedDescriptionKey: [NSString stringWithFormat:@"%s: %@", strerror(code), path] }];
}
static NSError *SparkCodedError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:@"so.legend.spark.logging" code:1 userInfo:@{ SparkLogCodeKey: code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkLogErrorCode(NSError *error) {
  return error.userInfo[SparkLogCodeKey] ?: SparkDesktopErrorCode(error);
}
static os_log_type_t SparkLogType(NSString *level) {
  if ([level isEqual:@"debug"]) return OS_LOG_TYPE_DEBUG;
  if ([level isEqual:@"info"]) return OS_LOG_TYPE_INFO;
  if ([level isEqual:@"error"]) return OS_LOG_TYPE_ERROR;
  if ([level isEqual:@"fault"]) return OS_LOG_TYPE_FAULT;
  return OS_LOG_TYPE_DEFAULT; // notice
}
// A JSON string literal, or nil for text JSON cannot hold (an unpaired surrogate).
static NSString *SparkQuote(NSString *text) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:text options:NSJSONWritingFragmentsAllowed | NSJSONWritingWithoutEscapingSlashes error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}
static id SparkSysctl(const char *name) {
  char value[256];
  size_t size = sizeof(value);
  return sysctlbyname(name, value, &size, NULL, 0) == 0 ? [NSString stringWithUTF8String:value] : NSNull.null;
}
static NSString *SparkThermalState(NSProcessInfoThermalState state) {
  switch (state) {
    case NSProcessInfoThermalStateNominal: return @"nominal";
    case NSProcessInfoThermalStateFair: return @"fair";
    case NSProcessInfoThermalStateSerious: return @"serious";
    case NSProcessInfoThermalStateCritical: return @"critical";
  }
  return @"unknown";
}

@implementation SparkLog {
  dispatch_queue_t _queue;
  std::atomic<long> _pending;  // Entries submitted and not yet handled.
  std::atomic<long> _overflow; // Entries dropped at submission since the queue last looked.
  NSString *_subsystem;
  NSString *_defaultDirectory;
  NSString *_level;
  NSDictionary *_files; // nil: file logging is off.
  NSMutableDictionary<NSString *, os_log_t> *_logs;
  os_log_t _own;
  NSISO8601DateFormatter *_time;
  int _fd;
  unsigned long long _size;
  NSError *_failure;  // The first failure since the last flush.
  long _dropped;      // Entries not written since the last flush.
  BOOL _failing;      // Announced, and no entry has been written since.
}

- (instancetype)initWithSubsystem:(NSString *)subsystem directory:(NSString *)directory
{
  if ((self = [super init])) {
    _queue = dispatch_queue_create("so.legend.spark.logging", DISPATCH_QUEUE_SERIAL);
    _maxPendingEntries = 10000;
    _subsystem = subsystem;
    _defaultDirectory = directory;
    _level = @"info";
    _files = [self defaultFiles];
    _logs = [NSMutableDictionary new];
    _own = os_log_create(subsystem.UTF8String, "spark.logging");
    _time = [NSISO8601DateFormatter new];
    _time.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    _fd = -1;
  }
  return self;
}
- (void)dealloc { [self closeFile]; }

- (void)log:(double)time level:(NSString *)level category:(NSString *)category message:(NSString *)message fields:(NSString *)fields publicMessage:(BOOL)publicMessage
{
  // The cap bounds memory when entries arrive faster than they are written (or an export holds the queue).
  if (_pending.load() >= self.maxPendingEntries) { _overflow++; return; }
  _pending++;
  dispatch_async(_queue, ^{
    [self takeOverflow];
    [self write:time level:level category:category message:message fields:fields publicMessage:publicMessage];
    self->_pending--;
  });
}
- (void)perform:(dispatch_block_t)block
{
  dispatch_async(_queue, ^{
    [self takeOverflow];
    block();
  });
}
- (void)takeOverflow
{
  long dropped = _overflow.exchange(0);
  if (dropped) [self failed:SparkCodedError(@"E_BUSY", [NSString stringWithFormat:@"The log queue held %ld entries", (long)self.maxPendingEntries]) dropped:dropped];
}

// The first failure is logged once to the unified log and announced; later ones only add to the count.
- (void)failed:(NSError *)error dropped:(long)dropped
{
  _failure = _failure ?: error;
  _dropped += dropped;
  if (_failing) return;
  _failing = YES;
  os_log_error(_own, "Log entries are not being written: %{public}s", error.localizedDescription.UTF8String);
  void (^handler)(NSDictionary *) = self.failureHandler;
  if (handler) handler(@{ @"code": SparkLogErrorCode(error), @"message": error.localizedDescription ?: @"", @"dropped": @(dropped) });
}
- (void)written
{
  if (!_failing) return;
  _failing = NO;
  void (^handler)(NSDictionary *) = self.failureHandler;
  if (handler) handler(@{ @"code": SparkLogErrorCode(_failure), @"message": _failure.localizedDescription ?: @"", @"dropped": @(_dropped), @"recovered": @YES });
}

- (NSDictionary *)defaultFiles { return @{ @"directory": _defaultDirectory, @"maxFileBytes": @(1024 * 1024), @"maxFiles": @5 }; }
// app.log is the current file; app.1.log the one before it, and so on.
- (NSString *)pathAt:(NSInteger)index
{
  return [_files[@"directory"] stringByAppendingPathComponent:index ? [NSString stringWithFormat:@"app.%ld.log", (long)index] : @"app.log"];
}
- (void)closeFile
{
  if (_fd >= 0) close(_fd);
  _fd = -1;
}
// Closes the file when app.log was deleted, moved or replaced by someone else, so the next write reopens it.
- (void)closeIfMoved
{
  struct stat open, current;
  if (_fd < 0) return;
  if (fstat(_fd, &open) != 0 || open.st_nlink == 0 || stat([self pathAt:0].fileSystemRepresentation, &current) != 0
      || open.st_ino != current.st_ino || open.st_dev != current.st_dev) [self closeFile];
}
- (BOOL)openFile:(NSError **)error
{
  if (_fd >= 0) return YES;
  if (![NSFileManager.defaultManager createDirectoryAtPath:_files[@"directory"] withIntermediateDirectories:YES attributes:nil error:error]) return NO;
  NSString *path = [self pathAt:0];
  int fd = open(path.fileSystemRepresentation, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
  struct stat info;
  if (fd < 0 || fstat(fd, &info) != 0) {
    if (error) *error = SparkPosixError(errno, path);
    if (fd >= 0) close(fd);
    return NO;
  }
  _fd = fd;
  _size = (unsigned long long)info.st_size;
  return YES;
}
// Shifts app.log to app.1.log and so on; the oldest file falls off the end.
- (BOOL)rotate:(NSError **)error
{
  [self closeFile];
  NSInteger maxFiles = [_files[@"maxFiles"] integerValue];
  if (maxFiles == 1 && unlink([self pathAt:0].fileSystemRepresentation) != 0 && errno != ENOENT) {
    if (error) *error = SparkPosixError(errno, [self pathAt:0]);
    return NO;
  }
  for (NSInteger index = maxFiles - 1; index > 0; index--) {
    if (rename([self pathAt:index - 1].fileSystemRepresentation, [self pathAt:index].fileSystemRepresentation) != 0 && errno != ENOENT) {
      if (error) *error = SparkPosixError(errno, [self pathAt:index - 1]);
      return NO;
    }
  }
  return [self openFile:error];
}

- (BOOL)configure:(NSDictionary *)options error:(NSError **)error
{
  NSDictionary *previous = _files;
  id requested = options[@"files"];
  if (requested == NSNull.null) _files = nil;
  else if ([requested isKindOfClass:NSDictionary.class]) {
    NSMutableDictionary *files = [(_files ?: [self defaultFiles]) mutableCopy];
    [files addEntriesFromDictionary:requested];
    _files = files;
  }
  if (![_files isEqual:previous]) {
    [self closeFile];
    // Open now, so a folder that cannot be written fails here rather than on a later entry.
    if (_files && ![self openFile:error]) {
      _files = previous;
      return NO;
    }
    // Files past a lowered maxFiles in the same folder would otherwise never rotate away.
    NSInteger from = [_files[@"maxFiles"] integerValue], to = [previous[@"maxFiles"] integerValue];
    if (_files && previous && [_files[@"directory"] isEqual:previous[@"directory"]])
      for (NSInteger index = from; index < to; index++) unlink([self pathAt:index].fileSystemRepresentation);
  }
  if (options[@"level"]) _level = options[@"level"];
  return YES;
}

- (void)write:(double)time level:(NSString *)level category:(NSString *)category message:(NSString *)message fields:(NSString *)fields publicMessage:(BOOL)publicMessage
{
  os_log_t log = _logs[category];
  if (!log) log = _logs[category] = os_log_create(_subsystem.UTF8String, category.UTF8String);
  os_log_type_t type = SparkLogType(level);
  if (publicMessage && fields.length) os_log_with_type(log, type, "%{public}s %{private}s", message.UTF8String, fields.UTF8String);
  else if (publicMessage) os_log_with_type(log, type, "%{public}s", message.UTF8String);
  else if (fields.length) os_log_with_type(log, type, "%{private}s %{private}s", message.UTF8String, fields.UTF8String);
  else os_log_with_type(log, type, "%{private}s", message.UTF8String);
  if (!_files) { [self written]; return; }

  NSString *quotedCategory = SparkQuote(category), *quotedMessage = SparkQuote(message);
  if (!quotedCategory || !quotedMessage) {
    [self failed:SparkCodedError(@"E_INVALID_DATA", @"A log entry's text is not valid Unicode") dropped:1];
    return;
  }
  NSString *stamp = [_time stringFromDate:[NSDate dateWithTimeIntervalSince1970:time / 1000]];
  NSString *text = [NSString stringWithFormat:@"{\"time\":\"%@\",\"level\":\"%@\",\"category\":%@,\"message\":%@%@}\n",
    stamp, level, quotedCategory, quotedMessage, fields.length ? [@",\"fields\":" stringByAppendingString:fields] : @""];
  NSData *line = [text dataUsingEncoding:NSUTF8StringEncoding];
  NSError *error = nil;
  unsigned long long maxFileBytes = [_files[@"maxFileBytes"] unsignedLongLongValue];
  [self closeIfMoved];
  if (![self openFile:&error] || (_size > 0 && _size + line.length > maxFileBytes && ![self rotate:&error])) {
    [self failed:error dropped:1];
    return;
  }
  const char *bytes = (const char *)line.bytes;
  size_t remaining = line.length;
  unsigned long long before = _size;
  while (remaining > 0) {
    ssize_t written = write(_fd, bytes, remaining);
    if (written < 0) {
      if (errno == EINTR) continue;
      NSError *failure = SparkPosixError(errno, [self pathAt:0]);
      // No torn line: a later entry must start on a line of its own.
      if (ftruncate(_fd, (off_t)before) == 0) _size = before;
      else [self closeFile];
      [self failed:failure dropped:1];
      return;
    }
    bytes += written;
    remaining -= (size_t)written;
    _size += (unsigned long long)written;
  }
  [self written];
}

- (NSError *)takeWriteError
{
  if (!_failure) return nil;
  NSMutableDictionary *info = [_failure.userInfo mutableCopy];
  info[SparkLogCodeKey] = SparkLogErrorCode(_failure);
  info[@"dropped"] = @(_dropped);
  info[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"%@ (%ld %@ not written)", _failure.localizedDescription, _dropped, _dropped == 1 ? @"entry" : @"entries"];
  NSError *error = [NSError errorWithDomain:_failure.domain code:_failure.code userInfo:info];
  _failure = nil;
  _dropped = 0;
  return error;
}

- (NSArray<NSDictionary *> *)files
{
  NSMutableArray *files = [NSMutableArray new];
  for (NSInteger index = 0; _files && index < [_files[@"maxFiles"] integerValue]; index++) {
    NSString *path = [self pathAt:index];
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil];
    if (!attributes) continue;
    [files addObject:@{ @"path": path, @"bytes": @(attributes.fileSize), @"modifiedAt": @(floor(attributes.fileModificationDate.timeIntervalSince1970 * 1000)) }];
  }
  return files;
}

- (NSDictionary *)configuration { return @{ @"level": _level, @"files": _files ?: NSNull.null }; }

// What the bundle says about the app and the Mac. No user name (the home folder is ~), host name or serial number.
- (NSDictionary *)diagnostics:(NSDictionary *)info
{
  NSBundle *bundle = NSBundle.mainBundle;
  NSProcessInfo *process = NSProcessInfo.processInfo;
  NSOperatingSystemVersion os = process.operatingSystemVersion;
  int translated = 0;
  size_t size = sizeof(translated);
  if (sysctlbyname("sysctl.proc_translated", &translated, &size, NULL, 0) != 0) translated = 0;
  id (^value)(id) = ^id(id object) { return object ?: NSNull.null; };
  return @{
    @"format": @1,
    @"createdAt": [_time stringFromDate:[NSDate date]],
    @"app": @{
      @"name": value([bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"] ?: process.processName),
      @"bundleIdentifier": value(bundle.bundleIdentifier),
      @"version": value([bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]),
      @"build": value([bundle objectForInfoDictionaryKey:@"CFBundleVersion"]),
      @"processIdentifier": @(process.processIdentifier),
    },
    @"system": @{
      @"os": @"macOS",
      @"osVersion": [NSString stringWithFormat:@"%ld.%ld.%ld", (long)os.majorVersion, (long)os.minorVersion, (long)os.patchVersion],
      @"osBuild": SparkSysctl("kern.osversion"),
      @"model": SparkSysctl("hw.model"),
#if defined(__arm64__)
      @"architecture": @"arm64",
#else
      @"architecture": @"x86_64",
#endif
      @"translated": @(translated == 1),
      @"processorCount": @(process.activeProcessorCount),
      @"physicalMemoryBytes": @(process.physicalMemory),
      @"thermalState": SparkThermalState(process.thermalState),
      @"lowPowerMode": @(process.lowPowerModeEnabled),
      @"uptimeSeconds": @(floor(process.systemUptime)),
      @"locale": NSLocale.currentLocale.localeIdentifier,
      @"preferredLanguages": NSLocale.preferredLanguages,
      @"timeZone": NSTimeZone.localTimeZone.name,
    },
    @"logging": @{ @"level": _level, @"files": _files ? @{ @"directory": [_files[@"directory"] stringByAbbreviatingWithTildeInPath], @"maxFileBytes": _files[@"maxFileBytes"], @"maxFiles": _files[@"maxFiles"] } : NSNull.null },
    @"info": value(info),
  };
}

- (NSDictionary *)exportDiagnosticsTo:(NSString *)path info:(NSDictionary *)info error:(NSError **)error
{
  NSFileManager *manager = NSFileManager.defaultManager;
  NSURL *work = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[@"spark-diagnostics-" stringByAppendingString:NSUUID.UUID.UUIDString]] isDirectory:YES];
  NSURL *folder = [work URLByAppendingPathComponent:@"Diagnostics" isDirectory:YES];
  NSURL *archive = [work URLByAppendingPathComponent:@"Diagnostics.zip"];
  NSMutableArray<NSString *> *entries = [NSMutableArray arrayWithObject:@"diagnostics.json"];
  // Only a regular file is replaced: a folder there would be swapped out whole, and a link followed.
  struct stat existing;
  BOOL exists = lstat(path.fileSystemRepresentation, &existing) == 0;
  if (exists && !S_ISREG(existing.st_mode)) {
    if (error) *error = SparkCodedError(@"E_ALREADY_EXISTS", [NSString stringWithFormat:@"%@ is a %@, not a file to replace", path, S_ISDIR(existing.st_mode) ? @"folder" : S_ISLNK(existing.st_mode) ? @"symbolic link" : @"special file"]);
    return nil;
  }
  @try {
    if (![manager createDirectoryAtURL:[folder URLByAppendingPathComponent:@"logs"] withIntermediateDirectories:YES attributes:nil error:error]) return nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:[self diagnostics:info] options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys | NSJSONWritingWithoutEscapingSlashes error:error];
    if (!json || ![json writeToURL:[folder URLByAppendingPathComponent:@"diagnostics.json"] options:0 error:error]) return nil;
    for (NSDictionary *file in [self files]) {
      NSString *name = [file[@"path"] lastPathComponent];
      if (![manager copyItemAtPath:file[@"path"] toPath:[folder.path stringByAppendingPathComponent:[@"logs" stringByAppendingPathComponent:name]] error:error]) return nil;
      [entries addObject:[@"logs/" stringByAppendingString:name]];
    }
    // Reading a folder "for uploading" makes Foundation zip it into a temporary file. Nothing is uploaded:
    // the archive is copied out before the block returns and only ever written to `path`.
    __block BOOL zipped = NO;
    __block NSError *copyError = nil;
    NSError *coordinationError = nil;
    [[[NSFileCoordinator alloc] initWithFilePresenter:nil] coordinateReadingItemAtURL:folder options:NSFileCoordinatorReadingForUploading error:&coordinationError byAccessor:^(NSURL *zip) {
      zipped = [manager copyItemAtURL:zip toURL:archive error:&copyError];
    }];
    if (!zipped) {
      if (error) *error = coordinationError ?: copyError;
      return nil;
    }
    NSURL *destination = [NSURL fileURLWithPath:path];
    BOOL placed = exists
      ? [manager replaceItemAtURL:destination withItemAtURL:archive backupItemName:nil options:0 resultingItemURL:nil error:error]
      : [manager moveItemAtURL:archive toURL:destination error:error];
    if (!placed) return nil;
    NSDictionary *attributes = [manager attributesOfItemAtPath:path error:error];
    return attributes ? @{ @"path": path, @"bytes": @(attributes.fileSize), @"entries": entries } : nil;
  } @finally {
    [manager removeItemAtURL:work error:nil];
  }
}
@end
