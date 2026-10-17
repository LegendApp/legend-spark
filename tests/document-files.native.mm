#import <Foundation/Foundation.h>
#import "SparkDocumentFiles.h"
#import "SparkFileIntegration.h"
#import "SparkFileMutations.h"
#import "SparkDesktopError.h"
#import <sys/stat.h>

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { fprintf(stderr, "FAIL: %s\n", message); failures++; } } while (0)
static NSString *Code(NSError *error) { return [error.domain isEqual:SparkFileIntegrationErrorDomain] ? error.userInfo[@"code"] : SparkDesktopErrorCode(error); }
static NSString *Read(NSURL *url) { return [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:nil]; }
static void Write(NSURL *url, NSString *text) { [text writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:nil]; }
// Each call drains its own pool, as the module's calls on its queue do, so no NSFileVersion outlives the call that made it.
#define CALL(expression) ({ __typeof__(expression) _value; @autoreleasepool { _value = (expression); } _value; })

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    // "-": a fresh folder in the temporary directory, which in the App Sandbox is the container's.
    BOOL scratch = !strcmp(argv[1], "-");
    NSString *root = scratch ? [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] : @(argv[1]);
    NSFileManager *fm = NSFileManager.defaultManager;
    if (scratch) [fm createDirectoryAtPath:root withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *doc = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"doc.txt"]];
    NSURL *missing = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"missing.txt"]];
    NSError *error = nil;

    // Missing files reject typed instead of reporting an empty history.
    CHECK(!SparkListFileVersions(missing, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "listing a missing file is E_NOT_FOUND");
    error = nil; CHECK(!SparkAddFileVersion(missing, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "adding a version of a missing file is E_NOT_FOUND");

    // Versions record contents, list newest first and are readable by id.
    Write(doc, @"first");
    error = nil; NSArray *initial = CALL(SparkListFileVersions(doc, &error));
    CHECK(initial && initial.count == 0, "a new file has no other versions");
    NSDictionary *first = CALL(SparkAddFileVersion(doc, &error));
    CHECK(first && [first[@"id"] length] > 0 && [first[@"modifiedAt"] doubleValue] > 0, error ? error.localizedDescription.UTF8String : "version added");
    error = nil; NSString *contents = CALL(SparkReadFileVersion(doc, first[@"id"], &error));
    CHECK([contents isEqual:@"first"], error ? error.localizedDescription.UTF8String : "a version reads its contents");
    error = nil; CHECK(!CALL(SparkReadFileVersion(doc, @"0000.txt", &error)) && [Code(error) isEqual:@"E_NOT_FOUND"], "reading an id of no version is E_NOT_FOUND");
    // Why versions are read by id (#462): in the App Sandbox on macOS 27 a version's stored file is readable only while its
    // NSFileVersion lives (macOS 26 still allows it), so only the unsandboxed read of a released version is asserted.
    NSString *stored = CALL([NSFileVersion otherVersionsOfItemAtURL:doc].firstObject.URL.path);
    BOOL sandboxed = NSProcessInfo.processInfo.environment[@"APP_SANDBOX_CONTAINER_ID"] != nil;
    CHECK(sandboxed || [Read([NSURL fileURLWithPath:stored]) isEqual:@"first"], "a released version's stored file is readable outside the sandbox");
    [NSThread sleepForTimeInterval:1.1]; // modification dates have one-second resolution on some volumes
    Write(doc, @"second");
    NSDictionary *second = CALL(SparkAddFileVersion(doc, &error));
    Write(doc, @"third");
    NSArray *versions = CALL(SparkListFileVersions(doc, &error));
    CHECK(versions.count == 2, "two recorded versions are listed");
    CHECK([versions.firstObject[@"id"] isEqual:second[@"id"]] && [versions.lastObject[@"id"] isEqual:first[@"id"]], "versions are newest first");

    // Restoring replaces the file and keeps the replaced contents as a version.
    error = nil; CHECK(CALL(SparkRestoreFileVersion(doc, first[@"id"], &error)), error ? error.localizedDescription.UTF8String : "version restored");
    CHECK([Read(doc) isEqual:@"first"], "restore replaces the contents");
    versions = CALL(SparkListFileVersions(doc, &error));
    BOOL keptThird = NO;
    for (NSDictionary *version in versions) if ([CALL(SparkReadFileVersion(doc, version[@"id"], nil)) isEqual:@"third"]) keptThird = YES;
    CHECK(versions.count == 3 && keptThird, "the replaced contents become a version");
    error = nil; CHECK(!SparkRestoreFileVersion(doc, @"../doc.txt", &error) && [Code(error) isEqual:@"E_INVALID_ARGUMENT"], "a malformed id is E_INVALID_ARGUMENT");
    error = nil; CHECK(!SparkRestoreFileVersion(doc, @"0000.txt", &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "an id of no version of this file is E_NOT_FOUND");

    // Versions follow a rename, as the session's rename and Move To rely on.
    NSURL *renamed = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"renamed.txt"]];
    error = nil; CHECK(SparkTransferPath(doc, renamed, SparkTransferMove, NO, &error), "renamed");
    CHECK([SparkListFileVersions(renamed, &error) count] == 3, "versions follow a rename");

    // Finder lock and replaceability.
    NSDictionary *state = SparkDocumentFileState(renamed, &error);
    CHECK([state[@"locked"] isEqual:@NO] && [state[@"writable"] isEqual:@YES], "an ordinary file is unlocked and writable");
    CHECK(SparkSetFileLocked(renamed, YES, &error), "locked");
    state = SparkDocumentFileState(renamed, &error);
    CHECK([state[@"locked"] isEqual:@YES] && [state[@"writable"] isEqual:@NO], "a locked file is locked and not writable");
    error = nil; CHECK(![@"x" writeToURL:renamed atomically:YES encoding:NSUTF8StringEncoding error:&error], "a locked file rejects replacement");
    error = nil; CHECK(!SparkTransferPath(renamed, doc, SparkTransferMove, NO, &error), "a locked file rejects a move");
    CHECK(SparkSetFileLocked(renamed, NO, &error) && [SparkDocumentFileState(renamed, &error)[@"locked"] isEqual:@NO], "unlocked");
    NSString *folder = [root stringByAppendingPathComponent:@"readonly"];
    [fm createDirectoryAtPath:folder withIntermediateDirectories:NO attributes:nil error:nil];
    NSURL *inside = [NSURL fileURLWithPath:[folder stringByAppendingPathComponent:@"doc.txt"]];
    Write(inside, @"x");
    chmod(folder.fileSystemRepresentation, 0555);
    CHECK([SparkDocumentFileState(inside, &error)[@"writable"] isEqual:@NO], "a file in a read-only folder cannot be replaced");
    chmod(folder.fileSystemRepresentation, 0755);
    error = nil; CHECK(!SparkDocumentFileState(missing, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "state of a missing file is E_NOT_FOUND");

    // A conditional write coordinated like writeTextIfUnchanged({ coordinated: true }) waits for another coordinated
    // writer and then sees its change, so it reports a conflict instead of overwriting it.
    Write(renamed, @"base");
    dispatch_semaphore_t holding = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSFileCoordinator *other = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      [other coordinateWritingItemAtURL:renamed options:NSFileCoordinatorWritingForReplacing error:nil byAccessor:^(NSURL *url) {
        dispatch_semaphore_signal(holding);
        [NSThread sleepForTimeInterval:0.3];
        Write(url, @"theirs");
      }];
    });
    dispatch_semaphore_wait(holding, DISPATCH_TIME_FOREVER);
    __block BOOL written = YES;
    error = nil;
    BOOL ran = SparkCoordinate(SparkCoordinateWrite, renamed, nil, &error, ^BOOL(NSURL *url, NSURL *unused, NSError **failure) {
      written = SparkWriteTextIfUnchanged(url, @"base", @"mine", failure);
      return *failure == nil;
    });
    CHECK(ran && !written && [Read(renamed) isEqual:@"theirs"], "a coordinated conditional write waits and reports the conflict");

    // Volumes without a revision store (passed in by the test runner) reject typed.
    if (argc > 2) {
      NSURL *fat = [NSURL fileURLWithPath:[@(argv[2]) stringByAppendingPathComponent:@"doc.txt"]];
      Write(fat, @"fat");
      error = nil; CHECK(!SparkAddFileVersion(fat, &error) && [Code(error) isEqual:@"E_UNAVAILABLE"], "a FAT volume is E_UNAVAILABLE");
    }

    [NSFileVersion removeOtherVersionsOfItemAtURL:renamed error:nil];
    if (scratch) [fm removeItemAtPath:root error:nil];
    if (failures) return 1;
    printf("Document file tests passed\n");
    return 0;
  }
}
