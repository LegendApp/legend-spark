// Drives the real SparkLog core (packages/logging/macos) without an app: JSON lines, rotation,
// configuration, write failures and their events, the queue cap, files moved away underneath it,
// the unified log (read back through OSLogStore) and diagnostics zips. It leaves one zip at
// <dir>/export/Diagnostics.zip for tests/logging-native.test.ts to unzip.
#import <OSLog/OSLog.h>
#import <signal.h>
#import <sys/resource.h>
#import <sys/stat.h>
#import "SparkLogging.h"

static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)

// Runs `block` on the log's queue after every earlier entry and waits for it.
static void Run(SparkLog *log, dispatch_block_t block) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [log perform:^{ block(); dispatch_semaphore_signal(done); }];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
}
static void Log(SparkLog *log, double time, NSString *level, NSString *category, NSString *message, NSString *fields) {
  [log log:time level:level category:category message:message fields:fields publicMessage:NO];
}
static NSArray<NSDictionary *> *Lines(NSString *path) {
  NSMutableArray *lines = [NSMutableArray new];
  for (NSString *line in [[NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] componentsSeparatedByString:@"\n"]) {
    if (!line.length) continue;
    id value = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    CHECK([value isKindOfClass:NSDictionary.class]);
    if (value) [lines addObject:value];
  }
  return lines;
}
static NSArray<NSString *> *Names(SparkLog *log) {
  __block NSArray *files;
  Run(log, ^{ files = log.files; });
  NSMutableArray *names = [NSMutableArray new];
  for (NSDictionary *file in files) [names addObject:[file[@"path"] lastPathComponent]];
  return names;
}
static NSError *Configure(SparkLog *log, NSDictionary *options) {
  __block NSError *error = nil;
  Run(log, ^{ if (![log configure:options error:&error] && !error) error = [NSError errorWithDomain:@"test" code:0 userInfo:nil]; });
  return error;
}
static NSDictionary *Configuration(SparkLog *log) {
  __block NSDictionary *configuration;
  Run(log, ^{ configuration = log.configuration; });
  return configuration;
}
static NSError *Flush(SparkLog *log) {
  __block NSError *error;
  Run(log, ^{ error = [log takeWriteError]; });
  return error;
}
static NSDictionary *Export(SparkLog *log, NSString *path, NSDictionary *info, NSError **error) {
  __block NSDictionary *result;
  __block NSError *failure;
  Run(log, ^{ result = [log exportDiagnosticsTo:path info:info error:&failure]; });
  if (error) *error = failure;
  return result;
}
// This process's recent unified log entries under `subsystem`. Reading the store takes seconds, so once.
static NSArray<OSLogEntryLog *> *Unified(NSString *subsystem) {
  NSError *error = nil;
  OSLogStore *store = [OSLogStore storeWithScope:OSLogStoreCurrentProcessIdentifier error:&error];
  CHECK(store != nil);
  NSMutableArray *entries = [NSMutableArray new];
  NSPredicate *predicate = [NSPredicate predicateWithFormat:@"subsystem == %@", subsystem];
  for (OSLogEntryLog *entry in [store entriesEnumeratorWithOptions:0 position:[store positionWithDate:[NSDate dateWithTimeIntervalSinceNow:-60]] predicate:predicate error:&error]) {
    if ([entry isKindOfClass:OSLogEntryLog.class]) [entries addObject:entry];
  }
  return entries;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    NSString *logs = [root stringByAppendingPathComponent:@"logs"], *other = [root stringByAppendingPathComponent:@"other"];
    NSFileManager *manager = NSFileManager.defaultManager;
    NSString *subsystem = [@"so.legend.spark.tests.logging." stringByAppendingString:NSUUID.UUID.UUIDString];
    SparkLog *log = [[SparkLog alloc] initWithSubsystem:subsystem directory:[root stringByAppendingPathComponent:@"default"]];
    NSMutableArray<NSDictionary *> *events = [NSMutableArray new];
    log.failureHandler = ^(NSDictionary *event) { [events addObject:event]; };

    // Defaults, before any configuration: info level, files on in the default folder, 1 MiB x 5.
    CHECK([Configuration(log) isEqual:(@{ @"level": @"info", @"files": @{ @"directory": [root stringByAppendingPathComponent:@"default"], @"maxFileBytes": @1048576, @"maxFiles": @5 } })]);

    // One entry is one JSON line: time (ISO 8601, UTC, milliseconds), level, category, message, fields.
    CHECK(!Configure(log, @{ @"files": @{ @"directory": logs, @"maxFileBytes": @4096, @"maxFiles": @3 } }));
    CHECK([manager fileExistsAtPath:[logs stringByAppendingPathComponent:@"app.log"]]); // opened by configure
    Log(log, 1760220000123, @"error", @"sync \"jobs\"", @"Upload failed / retrying\nline two ✓", @"{\"attempt\":2,\"ok\":false,\"tags\":[\"a\",null]}");
    Log(log, 1760220000124, @"info", @"sync", @"No fields", @"");
    CHECK(!Flush(log));
    NSArray *entries = Lines([logs stringByAppendingPathComponent:@"app.log"]);
    CHECK(entries.count == 2);
    CHECK([entries[0] isEqual:(@{ @"time": @"2025-10-11T22:00:00.123Z", @"level": @"error", @"category": @"sync \"jobs\"", @"message": @"Upload failed / retrying\nline two ✓", @"fields": @{ @"attempt": @2, @"ok": @NO, @"tags": @[@"a", NSNull.null] } })]);
    CHECK([entries[1] isEqual:(@{ @"time": @"2025-10-11T22:00:00.124Z", @"level": @"info", @"category": @"sync", @"message": @"No fields" })]);

    // Rotation: 300 entries of about 150 bytes through 4 KiB files, 3 kept. Every file stays under
    // the limit and the kept files hold one unbroken run of entries ending with the last.
    for (int index = 0; index < 300; index++) {
      Log(log, 1760220001000 + index, @"notice", @"rotation", [NSString stringWithFormat:@"Entry %03d %@", index, [@"" stringByPaddingToLength:40 withString:@"x" startingAtIndex:0]], [NSString stringWithFormat:@"{\"index\":%d}", index]);
    }
    CHECK([Names(log) isEqual:(@[@"app.log", @"app.1.log", @"app.2.log"])]);
    CHECK(![manager fileExistsAtPath:[logs stringByAppendingPathComponent:@"app.3.log"]]);
    NSMutableArray *kept = [NSMutableArray new];
    for (NSString *name in @[@"app.2.log", @"app.1.log", @"app.log"]) {
      NSString *path = [logs stringByAppendingPathComponent:name];
      CHECK([[manager attributesOfItemAtPath:path error:nil] fileSize] <= 4096);
      [kept addObjectsFromArray:Lines(path)];
    }
    CHECK(kept.count > 40);
    CHECK([[kept.lastObject[@"fields"] objectForKey:@"index"] isEqual:@299]);
    for (NSUInteger index = 1; index < kept.count; index++) CHECK([kept[index][@"fields"][@"index"] intValue] == [kept[index - 1][@"fields"][@"index"] intValue] + 1);
    __block NSArray *files;
    Run(log, ^{ files = log.files; });
    for (NSDictionary *file in files) CHECK([file[@"bytes"] isEqual:@([[manager attributesOfItemAtPath:file[@"path"] error:nil] fileSize])] && [file[@"modifiedAt"] doubleValue] > 1.7e12);

    // Moving to another folder leaves the first folder's files alone, even with a lower maxFiles.
    CHECK(!Configure(log, @{ @"files": @{ @"directory": other, @"maxFiles": @1 } }));
    CHECK([manager fileExistsAtPath:[logs stringByAppendingPathComponent:@"app.2.log"]]);
    // Lowering maxFiles in the same folder removes files past the new end.
    CHECK(!Configure(log, @{ @"files": @{ @"directory": logs, @"maxFiles": @3 } }));
    CHECK(!Configure(log, @{ @"files": @{ @"maxFiles": @2 } }));
    CHECK([Names(log) isEqual:(@[@"app.log", @"app.1.log"])]);
    CHECK(![manager fileExistsAtPath:[logs stringByAppendingPathComponent:@"app.2.log"]]);
    CHECK(!Configure(log, @{ @"level": @"debug" }));
    CHECK([Configuration(log) isEqual:(@{ @"level": @"debug", @"files": @{ @"directory": logs, @"maxFileBytes": @4096, @"maxFiles": @2 } })]);

    // A folder that cannot be created fails configure and keeps the current files.
    NSString *blocker = [root stringByAppendingPathComponent:@"blocker"];
    [@"x" writeToFile:blocker atomically:NO encoding:NSUTF8StringEncoding error:nil];
    CHECK(Configure(log, @{ @"files": @{ @"directory": [blocker stringByAppendingPathComponent:@"logs"] } }) != nil);
    CHECK([Configuration(log)[@"files"][@"directory"] isEqual:logs]);

    // app.log deleted or moved away underneath the log: the next entry goes to a new app.log.
    NSString *current = [logs stringByAppendingPathComponent:@"app.log"], *moved = [logs stringByAppendingPathComponent:@"moved.log"];
    CHECK([manager moveItemAtPath:current toPath:moved error:nil]);
    unsigned long long movedSize = [[manager attributesOfItemAtPath:moved error:nil] fileSize];
    Log(log, 1760220003000, @"info", @"external", @"After a move", @"");
    CHECK(!Flush(log));
    CHECK([Lines(current).lastObject[@"message"] isEqual:@"After a move"] && Lines(current).count == 1);
    CHECK([[manager attributesOfItemAtPath:moved error:nil] fileSize] == movedSize);
    CHECK([manager removeItemAtPath:current error:nil]);
    Log(log, 1760220003001, @"info", @"external", @"After a delete", @"");
    CHECK(!Flush(log));
    CHECK([Lines(current).lastObject[@"message"] isEqual:@"After a delete"] && Lines(current).count == 1);
    CHECK(events.count == 0);

    // A write cut short (here by the file size limit, as a full disk would) leaves no torn line.
    signal(SIGXFSZ, SIG_IGN);
    unsigned long long whole = [[manager attributesOfItemAtPath:current error:nil] fileSize];
    struct rlimit original, limit;
    getrlimit(RLIMIT_FSIZE, &original);
    limit = original;
    limit.rlim_cur = whole + 20;
    setrlimit(RLIMIT_FSIZE, &limit);
    Log(log, 1760220003002, @"info", @"external", [@"" stringByPaddingToLength:100 withString:@"z" startingAtIndex:0], @"");
    Run(log, ^{});
    setrlimit(RLIMIT_FSIZE, &original);
    CHECK([[manager attributesOfItemAtPath:current error:nil] fileSize] == whole);
    CHECK([[NSString stringWithContentsOfFile:current encoding:NSUTF8StringEncoding error:nil] hasSuffix:@"}\n"]);
    CHECK(events.count == 1 && [events[0][@"dropped"] isEqual:@1] && !events[0][@"recovered"]);
    // The next entry is written whole after it, and writing again is announced with the count.
    Log(log, 1760220003003, @"info", @"external", @"After the limit", @"");
    NSError *writeError = Flush(log);
    CHECK([Lines(current).lastObject[@"message"] isEqual:@"After the limit"]);
    CHECK(events.count == 2 && [events[1][@"recovered"] isEqual:@YES] && [events[1][@"dropped"] isEqual:@1]);
    CHECK(writeError && [writeError.userInfo[@"dropped"] isEqual:@1] && [writeError.localizedDescription hasSuffix:@"(1 entry not written)"]);
    [events removeAllObjects];

    // Failing rotation (a read-only folder): one event when it starts, a count of every entry lost,
    // one line in the unified log, and one error for the next flush.
    CHECK(!Configure(log, @{ @"files": @{ @"directory": other, @"maxFileBytes": @4096, @"maxFiles": @2 } }));
    chmod(other.fileSystemRepresentation, 0555);
    for (int index = 0; index < 40; index++) Log(log, 1760220002000, @"info", @"full", [@"" stringByPaddingToLength:200 withString:@"y" startingAtIndex:0], @"");
    Run(log, ^{});
    chmod(other.fileSystemRepresentation, 0755);
    CHECK(events.count == 1 && [events[0][@"code"] isEqual:@"E_PERMISSION"] && [events[0][@"dropped"] isEqual:@1]);
    writeError = Flush(log);
    long dropped = [writeError.userInfo[@"dropped"] longValue];
    CHECK(writeError != nil && [SparkLogErrorCode(writeError) isEqual:@"E_PERMISSION"] && dropped > 1 && dropped < 40);
    CHECK(Flush(log) == nil);
    [events removeAllObjects];
    Log(log, 1760220002001, @"info", @"full", @"Writable again", @"");
    CHECK(Flush(log) == nil);
    CHECK(events.count == 1 && [events[0][@"recovered"] isEqual:@YES] && [events[0][@"dropped"] isEqual:@0]);
    [events removeAllObjects];

    // The queue cap: with the queue held, entries past maxPendingEntries are dropped and counted (E_BUSY).
    log.maxPendingEntries = 3;
    dispatch_semaphore_t hold = dispatch_semaphore_create(0), held = dispatch_semaphore_create(0);
    [log perform:^{ dispatch_semaphore_signal(held); dispatch_semaphore_wait(hold, DISPATCH_TIME_FOREVER); }];
    dispatch_semaphore_wait(held, DISPATCH_TIME_FOREVER);
    for (int index = 0; index < 10; index++) Log(log, 1760220004000 + index, @"info", @"cap", [NSString stringWithFormat:@"Capped %d", index], @"");
    dispatch_semaphore_signal(hold);
    writeError = Flush(log);
    log.maxPendingEntries = 10000;
    CHECK([SparkLogErrorCode(writeError) isEqual:@"E_BUSY"] && [writeError.userInfo[@"dropped"] isEqual:@7]);
    CHECK(events.count == 2 && [events[0][@"code"] isEqual:@"E_BUSY"] && [events[0][@"dropped"] isEqual:@7] && [events[1][@"recovered"] isEqual:@YES]);
    NSArray *capped = [Lines([other stringByAppendingPathComponent:@"app.log"]) filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"category == 'cap'"]];
    CHECK([[capped valueForKey:@"message"] isEqual:(@[@"Capped 0", @"Capped 1", @"Capped 2"])]);
    [events removeAllObjects];

    // files: null stops file logging: no files listed, nothing written; the unified log still gets entries.
    CHECK(!Configure(log, @{ @"files": NSNull.null }));
    CHECK(Names(log).count == 0 && Configuration(log)[@"files"] == NSNull.null);
    NSString *marker = [@"Unified log marker " stringByAppendingString:NSUUID.UUID.UUIDString];
    [log log:NSDate.date.timeIntervalSince1970 * 1000 level:@"error" category:@"unified" message:marker fields:@"{\"secret\":1}" publicMessage:YES];
    NSString *plain = [@"Plain marker " stringByAppendingString:NSUUID.UUID.UUIDString];
    [log log:NSDate.date.timeIntervalSince1970 * 1000 level:@"notice" category:@"unified" message:plain fields:@"" publicMessage:YES];
    NSString *hidden = [@"Private marker " stringByAppendingString:NSUUID.UUID.UUIDString];
    Log(log, NSDate.date.timeIntervalSince1970 * 1000, @"notice", @"private", hidden, @"");
    CHECK(!Flush(log));
    CHECK(![[NSString stringWithContentsOfFile:[other stringByAppendingPathComponent:@"app.log"] encoding:NSUTF8StringEncoding error:nil] containsString:marker]);
    NSArray<OSLogEntryLog *> *unified = Unified(subsystem);
    NSArray<OSLogEntryLog *> *(^category)(NSString *) = ^(NSString *name) { return [unified filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"category == %@", name]]; };
    // Public messages appear as written, at their level; fields stay private.
    BOOL withFields = NO, alone = NO;
    for (OSLogEntryLog *entry in category(@"unified")) {
      if ([entry.composedMessage hasPrefix:marker]) withFields = entry.level == OSLogEntryLogLevelError && ![entry.composedMessage containsString:@"secret"];
      if ([entry.composedMessage isEqual:plain]) alone = entry.level == OSLogEntryLogLevelNotice;
    }
    CHECK(withFields && alone);
    // A message is private unless the logger asked for public messages.
    NSArray<OSLogEntryLog *> *privates = category(@"private");
    CHECK(privates.count == 1 && ![privates.firstObject.composedMessage containsString:hidden]);
    // Each failure was logged once: the size limit, then the read-only folder, then the full queue.
    NSArray<OSLogEntryLog *> *own = category(@"spark.logging");
    CHECK(own.count == 3 && own.lastObject.level == OSLogEntryLogLevelError);

    // Diagnostics: back on the 2-file folder; the zip holds diagnostics.json and both log files.
    CHECK(!Configure(log, @{ @"files": @{ @"directory": logs, @"maxFileBytes": @4096, @"maxFiles": @2 } }));
    NSString *exportFolder = [root stringByAppendingPathComponent:@"export"], *zip = [exportFolder stringByAppendingPathComponent:@"Diagnostics.zip"];
    [manager createDirectoryAtPath:exportFolder withIntermediateDirectories:YES attributes:nil error:nil];
    [@"stale" writeToFile:zip atomically:NO encoding:NSUTF8StringEncoding error:nil]; // replaced
    NSError *error = nil;
    NSDictionary *result = Export(log, zip, @{ @"ticket": @"KS-1", @"flags": @[@"beta"] }, &error);
    CHECK([result[@"path"] isEqual:zip]);
    CHECK([result[@"entries"] isEqual:(@[@"diagnostics.json", @"logs/app.log", @"logs/app.1.log"])]);
    CHECK([result[@"bytes"] isEqual:@([[manager attributesOfItemAtPath:zip error:nil] fileSize])] && [result[@"bytes"] intValue] > 200);
    NSData *head = [[NSFileHandle fileHandleForReadingAtPath:zip] readDataOfLength:4];
    CHECK([head isEqual:[NSData dataWithBytes:"PK\x03\x04" length:4]]);
    // Staging folders are removed.
    for (NSString *name in [manager contentsOfDirectoryAtPath:NSTemporaryDirectory() error:nil]) CHECK(![name hasPrefix:@"spark-diagnostics-"]);

    // A folder at the destination is refused, contents untouched; so is a symbolic link, and its target.
    NSString *folder = [root stringByAppendingPathComponent:@"Documents"], *keep = [folder stringByAppendingPathComponent:@"keep.txt"];
    [manager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
    [@"keep" writeToFile:keep atomically:NO encoding:NSUTF8StringEncoding error:nil];
    CHECK(!Export(log, folder, nil, &error) && [SparkLogErrorCode(error) isEqual:@"E_ALREADY_EXISTS"]);
    CHECK([[NSString stringWithContentsOfFile:keep encoding:NSUTF8StringEncoding error:nil] isEqual:@"keep"]);
    NSString *link = [root stringByAppendingPathComponent:@"link.zip"];
    CHECK([manager createSymbolicLinkAtPath:link withDestinationPath:keep error:nil]);
    CHECK(!Export(log, link, nil, &error) && [SparkLogErrorCode(error) isEqual:@"E_ALREADY_EXISTS"]);
    CHECK([[manager destinationOfSymbolicLinkAtPath:link error:nil] isEqual:keep]);
    CHECK([[NSString stringWithContentsOfFile:keep encoding:NSUTF8StringEncoding error:nil] isEqual:@"keep"]);

    // A missing destination folder is E_NOT_FOUND.
    CHECK(!Export(log, [root stringByAppendingPathComponent:@"missing/Diagnostics.zip"], nil, &error));
    CHECK([SparkLogErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  }
  if (failures) { fprintf(stderr, "%d logging checks failed\n", failures); return 1; }
  printf("Logging native tests passed\n");
  return 0;
}
