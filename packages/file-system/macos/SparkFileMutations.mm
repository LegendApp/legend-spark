#import "SparkFileMutations.h"
#import <sys/stat.h>
#import <errno.h>

BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error) {
  NSString *current = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:error];
  if (!current || ![current isEqualToString:expected]) return NO;
  return [text writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:error];
}

BOOL SparkTransferPath(NSURL *from, NSURL *to, SparkTransferKind kind, BOOL overwrite, NSError **error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  // lstat sees a dangling link, which copy/move would otherwise fail opaquely.
  struct stat existing;
  if (lstat(to.fileSystemRepresentation, &existing) == 0) {
    if (!overwrite) {
      if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteFileExistsError userInfo:nil];
      return NO;
    }
    if (![fm removeItemAtURL:to error:error]) return NO;
  } else if (errno != ENOENT && errno != ENOTDIR) {
    if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
    return NO;
  }
  return kind == SparkTransferCopy
    ? [fm copyItemAtURL:from toURL:to error:error]
    : [fm moveItemAtURL:from toURL:to error:error];
}

BOOL SparkRemoveFile(NSURL *url, BOOL recursive, NSError **error) {
  struct stat info;
  if (lstat(url.fileSystemRepresentation, &info) != 0) {
    int code = errno;
    if (code == ENOENT || code == ENOTDIR) return NO;
    if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain
      code:(code == EACCES || code == EPERM) ? NSFileReadNoPermissionError : NSFileReadUnknownError
      userInfo:@{NSUnderlyingErrorKey: [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil]}];
    return NO;
  }
  NSFileManager *fm = NSFileManager.defaultManager;
  if (S_ISDIR(info.st_mode) && !recursive) {
    NSArray *children = [fm contentsOfDirectoryAtPath:url.path error:error];
    if (!children) return NO;
    if (children.count) {
      if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:ENOTEMPTY userInfo:nil];
      return NO;
    }
  }
  return [fm removeItemAtURL:url error:error];
}
