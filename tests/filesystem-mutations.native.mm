#import "SparkFileMutations.h"
#import <sys/stat.h>
#import <errno.h>
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main(int argc, const char **argv) { @autoreleasepool {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSURL *root = [NSURL fileURLWithPath:@(argv[1]) isDirectory:YES];
  NSURL *file = [root URLByAppendingPathComponent:@"document.txt"];
  NSError *error = nil;
  check([@"before" writeToURL:file atomically:YES encoding:NSUTF8StringEncoding error:&error], "create file");
  check(SparkWriteTextIfUnchanged(file, @"before", @"after", &error) && !error, "write observed version");
  check(!SparkWriteTextIfUnchanged(file, @"before", @"lost", &error) && !error, "detect conflict");
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"after"], "conflict preserves bytes");
  NSURL *missing = [root URLByAppendingPathComponent:@"missing"];
  check(!SparkWriteTextIfUnchanged(missing, @"", @"lost", &error) && error, "missing input rejects"); error = nil;
  NSURL *link = [root URLByAppendingPathComponent:@"dangling"];
  check([fm createSymbolicLinkAtURL:link withDestinationURL:missing error:&error], "create dangling link");
  check(SparkRemoveFile(link, NO, &error) && !error, "remove dangling link itself");
  check(!SparkRemoveFile(link, NO, &error) && !error, "repeat removal is absent");
  check(!SparkRemoveFile(root, NO, &error) && [error.domain isEqual:NSPOSIXErrorDomain] && error.code == ENOTEMPTY, "nonempty directory rejects"); error = nil;
  NSURL *copySource = [root URLByAppendingPathComponent:@"copy-source"];
  check([@"source" writeToURL:copySource atomically:YES encoding:NSUTF8StringEncoding error:&error], "create transfer source");
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, NO, &error) && error.code == NSFileWriteFileExistsError, "copy conflicts with an existing destination"); error = nil;
  check(SparkTransferPath(copySource, file, SparkTransferCopy, YES, &error) && !error, "copy replaces the destination");
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"source"], "replacement carries new bytes");
  NSURL *dangling = [root URLByAppendingPathComponent:@"dangling-destination"];
  check([fm createSymbolicLinkAtURL:dangling withDestinationURL:missing error:&error], "create dangling destination link");
  check(SparkTransferPath(copySource, dangling, SparkTransferCopy, YES, &error) && !error, "replacement overwrites a dangling link");
  check(SparkTransferPath(dangling, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, NO, &error) && !error, "move to an absent path");
  check(!SparkTransferPath(copySource, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, NO, &error) && error.code == NSFileWriteFileExistsError, "move conflicts with an existing destination"); error = nil;
  check(SparkTransferPath(copySource, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, YES, &error) && !error, "move replaces the destination");
  check(![fm fileExistsAtPath:copySource.path], "replacement move removes the source"); error = nil;
  NSURL *blockedDirectory = [root URLByAppendingPathComponent:@"protected" isDirectory:YES];
  check([fm createDirectoryAtURL:blockedDirectory withIntermediateDirectories:NO attributes:nil error:&error], "create protected directory");
  NSURL *child = [blockedDirectory URLByAppendingPathComponent:@"child"];
  check([@"private" writeToURL:child atomically:YES encoding:NSUTF8StringEncoding error:&error], "create protected file");
  check(chmod(blockedDirectory.fileSystemRepresentation, 0000) == 0, "remove traversal permission");
  BOOL removed = SparkRemoveFile(child, NO, &error);
  chmod(blockedDirectory.fileSystemRepresentation, 0700);
  check(!removed && error.code == NSFileReadNoPermissionError, "permission failure is not absence"); error = nil;
  check(SparkRemoveFile(blockedDirectory, YES, &error) && !error, "recursive removal");
  puts("Filesystem mutation tests passed");
} }
