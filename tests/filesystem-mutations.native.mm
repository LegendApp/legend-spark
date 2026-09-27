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
