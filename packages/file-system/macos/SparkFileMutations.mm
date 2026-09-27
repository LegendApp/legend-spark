#import "SparkFileMutations.h"
#import <sys/stat.h>
#import <errno.h>

BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error) {
  NSString *current = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:error];
  if (!current || ![current isEqualToString:expected]) return NO;
  return [text writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:error];
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
