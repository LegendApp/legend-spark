#import "SparkFileMutations.h"
#import <sys/stat.h>
#import <errno.h>
#import <unistd.h>
#import <limits.h>
#import <stdio.h>

#if defined(SPARK_FILE_MUTATIONS_TESTING)
static unsigned SparkTransferTestFailures;
static BOOL SparkForceCrossVolumeMove;
void SparkSetTransferTestFailures(unsigned failures, BOOL forceCrossVolumeMove) {
  SparkTransferTestFailures = failures;
  SparkForceCrossVolumeMove = forceCrossVolumeMove;
}
static BOOL SparkTakeTransferTestFailure(unsigned failure) {
  if (!(SparkTransferTestFailures & failure)) return NO;
  SparkTransferTestFailures &= ~failure;
  errno = EIO;
  return YES;
}
#define SPARK_TAKE_FAILURE(failure) SparkTakeTransferTestFailure(failure)
#else
#define SPARK_TAKE_FAILURE(failure) NO
enum { SparkFailStageCopy = 0, SparkFailPublish = 0, SparkFailRestoreDestination = 0, SparkFailRestoreSource = 0,
  SparkFailSourceRemoval = 0, SparkFailBackupRemoval = 0, SparkFailStageCleanup = 0 };
#endif

static int SparkPublishRename(NSString *from, NSString *to, unsigned failure) {
#if !defined(SPARK_FILE_MUTATIONS_TESTING)
  (void)failure;
#endif
  return SPARK_TAKE_FAILURE(failure) ? -1 : renamex_np(from.fileSystemRepresentation, to.fileSystemRepresentation, RENAME_EXCL);
}

static NSString *SparkSiblingPath(NSURL *url, NSString *label) {
  return [url.URLByDeletingLastPathComponent.path stringByAppendingPathComponent:
    [NSString stringWithFormat:@".spark-%@-%@", label, NSUUID.UUID.UUIDString]];
}

static NSString *SparkResolvedPath(NSURL *url) {
  char resolved[PATH_MAX];
  if (realpath(url.fileSystemRepresentation, resolved)) return @(resolved);
  NSString *parent = url.URLByDeletingLastPathComponent.path;
  if (realpath(parent.fileSystemRepresentation, resolved))
    return [[@(resolved) stringByAppendingPathComponent:url.lastPathComponent] stringByStandardizingPath];
  return url.URLByStandardizingPath.path;
}

static BOOL SparkPathContains(NSString *parent, NSString *child) {
  if ([parent isEqualToString:child]) return YES;
  NSString *prefix = [parent hasSuffix:@"/"] ? parent : [parent stringByAppendingString:@"/"];
  return [child hasPrefix:prefix];
}

static BOOL SparkRejectUnsafeRelationship(NSURL *from, NSURL *to, NSError **error) {
  struct stat sourceInfo, destinationInfo;
  BOOL sourceExists = lstat(from.fileSystemRepresentation, &sourceInfo) == 0;
  BOOL destinationExists = lstat(to.fileSystemRepresentation, &destinationInfo) == 0;
  BOOL sameInode = sourceExists && destinationExists && sourceInfo.st_dev == destinationInfo.st_dev && sourceInfo.st_ino == destinationInfo.st_ino;
  NSString *sourcePath = SparkResolvedPath(from), *destinationPath = SparkResolvedPath(to);
  BOOL overlap = SparkPathContains(sourcePath, destinationPath) || SparkPathContains(destinationPath, sourcePath);
  if (!sameInode && !overlap) return NO;
  if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteInvalidFileNameError userInfo:@{NSLocalizedDescriptionKey: @"Source and destination identify or contain one another"}];
  return YES;
}

BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error) {
  NSString *current = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:error];
  if (!current || ![current isEqualToString:expected]) return NO;
  return [text writeToURL:url atomically:YES encoding:NSUTF8StringEncoding error:error];
}

BOOL SparkTransferPath(NSURL *from, NSURL *to, SparkTransferKind kind, BOOL overwrite, NSError **error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  if (SparkRejectUnsafeRelationship(from, to, error)) return NO;
  struct stat existing;
  BOOL destinationExists = NO;
  if (lstat(to.fileSystemRepresentation, &existing) == 0) {
    destinationExists = YES;
    if (!overwrite) {
      if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteFileExistsError userInfo:nil];
      return NO;
    }
  } else if (errno != ENOENT && errno != ENOTDIR) {
    if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
    return NO;
  }
  NSString *stagePath = SparkSiblingPath(to, @"stage");
  NSURL *stage = [NSURL fileURLWithPath:stagePath];
  struct stat sourceStat, parentStat;
  BOOL sameVolumeMove = kind == SparkTransferMove && lstat(from.fileSystemRepresentation, &sourceStat) == 0 &&
    stat(to.URLByDeletingLastPathComponent.fileSystemRepresentation, &parentStat) == 0 && sourceStat.st_dev == parentStat.st_dev;
#if defined(SPARK_FILE_MUTATIONS_TESTING)
  if (SparkForceCrossVolumeMove) sameVolumeMove = NO;
#endif
  BOOL stagedByRename = NO;
  if (sameVolumeMove) {
    if (rename(from.fileSystemRepresentation, stage.fileSystemRepresentation) != 0) {
      int code = errno;
      if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil];
      return NO;
    }
    stagedByRename = YES;
  } else {
    NSError *copyError = nil;
    BOOL staged = YES;
    if (SPARK_TAKE_FAILURE(SparkFailStageCopy)) {
#if defined(SPARK_FILE_MUTATIONS_TESTING)
      [@"partial stage" writeToURL:stage atomically:YES encoding:NSUTF8StringEncoding error:nil];
#endif
      copyError = [NSError errorWithDomain:NSPOSIXErrorDomain code:EIO userInfo:nil];
      staged = NO;
    } else {
      staged = [fm copyItemAtURL:from toURL:stage error:&copyError];
    }
    if (!staged) {
      NSMutableDictionary *info = [copyError.userInfo mutableCopy] ?: [NSMutableDictionary dictionary];
      struct stat partial;
      if (lstat(stage.fileSystemRepresentation, &partial) == 0) {
        NSError *cleanupError = nil;
        BOOL failCleanup = SPARK_TAKE_FAILURE(SparkFailStageCleanup);
        if (failCleanup) cleanupError = [NSError errorWithDomain:NSPOSIXErrorDomain code:EIO userInfo:nil];
        if (failCleanup || ![fm removeItemAtURL:stage error:&cleanupError]) {
          info[@"SparkRecoverableStagePath"] = stagePath;
          info[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"Transfer staging failed and partial stage cleanup failed; recoverable stage: %@", stagePath];
          if (cleanupError) info[@"SparkStageCleanupError"] = cleanupError;
        }
      }
      if (error) *error = [NSError errorWithDomain:(copyError.domain ?: NSPOSIXErrorDomain)
        code:(copyError ? copyError.code : EIO) userInfo:info];
      return NO;
    }
  }
  NSString *backupPath = nil;
  if (destinationExists) {
    backupPath = SparkSiblingPath(to, @"backup");
    if (rename(to.fileSystemRepresentation, backupPath.fileSystemRepresentation) != 0) {
      int code = errno;
      int rollbackCode = 0;
      if (stagedByRename && SparkPublishRename(stagePath, from.path, SparkFailRestoreSource) != 0) rollbackCode = errno;
      else if (!stagedByRename && ![fm removeItemAtURL:stage error:nil]) rollbackCode = errno ?: EIO;
      if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:rollbackCode ? @{
        NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Destination staging failed and source rollback failed (%d); recoverable source: %@", rollbackCode, stagePath],
        NSUnderlyingErrorKey: [NSError errorWithDomain:NSPOSIXErrorDomain code:rollbackCode userInfo:nil],
        @"SparkRecoverableStagePath": stagePath,
      } : nil];
      return NO;
    }
  }
  int publishResult = SparkPublishRename(stagePath, to.path, SparkFailPublish);
  if (publishResult != 0) {
    int code = errno;
    int rollbackCode = 0;
    if (backupPath && SparkPublishRename(backupPath, to.path, SparkFailRestoreDestination) != 0) rollbackCode = errno;
    if (stagedByRename && SparkPublishRename(stagePath, from.path, SparkFailRestoreSource) != 0) rollbackCode = errno;
    if (!stagedByRename && ![fm removeItemAtURL:stage error:nil]) rollbackCode = errno ?: EIO;
    if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:rollbackCode ? @{
      NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Transfer publication failed and rollback failed (%d); recoverable stage: %@; destination backup: %@", rollbackCode, stagePath, backupPath ?: @"none"],
      NSUnderlyingErrorKey: [NSError errorWithDomain:NSPOSIXErrorDomain code:rollbackCode userInfo:nil],
      @"SparkRecoverableStagePath": stagePath,
      @"SparkRecoverableBackupPath": backupPath ?: @"",
    } : nil];
    return NO;
  }
  BOOL failSourceRemoval = SPARK_TAKE_FAILURE(SparkFailSourceRemoval);
  if (kind == SparkTransferMove && !stagedByRename && (failSourceRemoval || ![fm removeItemAtURL:from error:error])) {
    if (failSourceRemoval && error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:EIO userInfo:nil];
    if (error && *error) {
      NSMutableDictionary *info = [(*error).userInfo mutableCopy] ?: [NSMutableDictionary dictionary];
      info[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"Source cleanup failed after publishing %@; source may be partially removed%@", to.path, backupPath ? [NSString stringWithFormat:@"; previous destination is retained at %@", backupPath] : @""];
      info[@"SparkPublishedDestinationPath"] = to.path;
      if (backupPath) info[@"SparkPreviousDestinationBackupPath"] = backupPath;
      *error = [NSError errorWithDomain:(*error).domain code:(*error).code userInfo:info];
    }
    return NO;
  }
  if (backupPath) {
    NSError *cleanupError = nil;
    BOOL failCleanup = SPARK_TAKE_FAILURE(SparkFailBackupRemoval);
    BOOL removed = !failCleanup && [fm removeItemAtPath:backupPath error:&cleanupError];
    if (!removed) {
      if (failCleanup) cleanupError = [NSError errorWithDomain:NSPOSIXErrorDomain code:EIO userInfo:nil];
      if (error) *error = [NSError errorWithDomain:(cleanupError.domain ?: NSPOSIXErrorDomain) code:cleanupError.code userInfo:@{
        NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Transfer committed at %@, but previous destination cleanup failed; recoverable backup: %@", to.path, backupPath],
        NSUnderlyingErrorKey: cleanupError ?: [NSError errorWithDomain:NSPOSIXErrorDomain code:EIO userInfo:nil],
        @"SparkPublishedDestinationPath": to.path,
        @"SparkRecoverableBackupPath": backupPath,
      }];
      return NO;
    }
  }
  return YES;
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
