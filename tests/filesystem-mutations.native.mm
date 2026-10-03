#import "SparkFileMutations.h"
#import "SparkDesktopError.h"
#import <sys/stat.h>
#import <errno.h>
#import <fcntl.h>
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main(int argc, const char **argv) { @autoreleasepool {
  NSFileManager *fm = NSFileManager.defaultManager;
  check([SparkDesktopErrorCode([NSError errorWithDomain:NSPOSIXErrorDomain code:EEXIST userInfo:nil]) isEqual:@"E_EXISTS"], "map POSIX destination conflict to public exists code");
  check([SparkDesktopErrorCode([NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteInvalidFileNameError userInfo:nil]) isEqual:@"E_INVALID_ARGUMENT"], "map unsafe transfer relationship to invalid argument");
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
  error = nil;
  check(!SparkTransferPath(missing, file, SparkTransferCopy, YES, &error) && error, "missing source rejects overwrite"); error = nil;
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"source"], "failed staging preserves the destination");
  check(!SparkTransferPath(copySource, copySource, SparkTransferCopy, YES, &error) && error, "self-copy rejects"); error = nil;
  check(!SparkTransferPath(copySource, copySource, SparkTransferMove, YES, &error) && error, "self-move rejects"); error = nil;
  SparkSetTransferTestFailures(SparkFailStageCopy, NO);
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, YES, &error) && error, "injected stage-copy failure rejects"); error = nil;
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"source"], "stage-copy failure preserves destination"); error = nil;
  SparkSetTransferTestFailures(SparkFailStageCopy, NO);
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, YES, NULL), "stage-copy failure rejects without error output");
  NSArray *rootEntries = [fm contentsOfDirectoryAtPath:root.path error:nil];
  check([[rootEntries filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *name, NSDictionary *bindings) {
    return [name hasPrefix:@".spark-stage-"];
  }]] count] == 0, "failed stage copy cleans partial staging when caller omits error output");
  SparkSetTransferTestFailures(SparkFailStageCopy | SparkFailStageCleanup, NO);
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, YES, &error) && error, "injected stage cleanup failure rejects");
  NSString *partialStage = error.userInfo[@"SparkRecoverableStagePath"];
  check(partialStage.length && [error.localizedDescription containsString:partialStage], "stage cleanup error exposes retained path");
  check([[NSString stringWithContentsOfFile:partialStage encoding:NSUTF8StringEncoding error:nil] isEqual:@"partial stage"], "stage cleanup failure preserves recovery bytes");
  check([fm removeItemAtPath:partialStage error:nil], "remove test recovery stage"); error = nil;
  SparkSetTransferTestFailures(SparkFailPublish, NO);
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, YES, &error) && error, "injected publication failure rejects"); error = nil;
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"source"], "publication rollback restores destination"); error = nil;
  NSURL *moveSource = [root URLByAppendingPathComponent:@"move-source"];
  check([@"move-by-rename" writeToURL:moveSource atomically:YES encoding:NSUTF8StringEncoding error:&error], "create same-volume move source");
  struct stat beforeMove, afterMove;
  check(stat(moveSource.fileSystemRepresentation, &beforeMove) == 0, "stat move source");
  SparkSetTransferTestFailures(SparkFailPublish, NO);
  check(!SparkTransferPath(moveSource, file, SparkTransferMove, YES, &error) && error, "injected move publication failure rejects"); error = nil;
  check(stat(moveSource.fileSystemRepresentation, &afterMove) == 0 && beforeMove.st_ino == afterMove.st_ino, "failed same-volume move restores original inode");
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:&error] isEqual:@"source"], "failed move restores previous destination"); error = nil;
  SparkSetTransferTestFailures(SparkFailPublish | SparkFailRestoreDestination | SparkFailRestoreSource, NO);
  check(!SparkTransferPath(moveSource, file, SparkTransferMove, YES, &error) && error, "injected rollback failures reject");
  NSString *recoverableStage = error.userInfo[@"SparkRecoverableStagePath"];
  NSString *recoverableBackup = error.userInfo[@"SparkRecoverableBackupPath"];
  check(recoverableStage.length && recoverableBackup.length, "rollback error reports recovery paths");
  check([[NSString stringWithContentsOfFile:recoverableStage encoding:NSUTF8StringEncoding error:nil] isEqual:@"move-by-rename"], "failed rollback preserves staged source bytes");
  check([[NSString stringWithContentsOfFile:recoverableBackup encoding:NSUTF8StringEncoding error:nil] isEqual:@"source"], "failed rollback preserves previous destination bytes");
  check([error.localizedDescription containsString:recoverableStage] && [error.localizedDescription containsString:recoverableBackup], "rollback error message exposes recovery paths"); error = nil;
  check(rename(recoverableStage.fileSystemRepresentation, moveSource.fileSystemRepresentation) == 0, "recover staged move source");
  check(rename(recoverableBackup.fileSystemRepresentation, file.fileSystemRepresentation) == 0, "recover previous destination");
  NSURL *crossMoveSource = [root URLByAppendingPathComponent:@"cross-move-source"];
  check([@"cross-source" writeToURL:crossMoveSource atomically:YES encoding:NSUTF8StringEncoding error:&error], "create cross-volume move source");
  SparkSetTransferTestFailures(SparkFailSourceRemoval, YES);
  check(!SparkTransferPath(crossMoveSource, file, SparkTransferMove, YES, &error) && error, "injected cross-volume source cleanup failure rejects");
  NSString *previousDestination = error.userInfo[@"SparkPreviousDestinationBackupPath"];
  check(previousDestination.length && [[NSString stringWithContentsOfFile:previousDestination encoding:NSUTF8StringEncoding error:nil] isEqual:@"source"], "source cleanup failure retains previous destination bytes");
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:nil] isEqual:@"cross-source"], "source cleanup failure leaves complete published destination");
  check([error.localizedDescription containsString:previousDestination], "source cleanup error exposes retained backup"); error = nil;
  SparkSetTransferTestFailures(SparkFailBackupRemoval, NO);
  check(!SparkTransferPath(copySource, file, SparkTransferCopy, YES, &error) && error, "injected backup cleanup failure rejects after commit");
  NSString *committedBackup = error.userInfo[@"SparkRecoverableBackupPath"];
  check(committedBackup.length && [[NSString stringWithContentsOfFile:committedBackup encoding:NSUTF8StringEncoding error:nil] isEqual:@"cross-source"], "backup cleanup failure preserves old destination bytes");
  check([[NSString stringWithContentsOfURL:file encoding:NSUTF8StringEncoding error:nil] isEqual:@"source"], "backup cleanup failure reports a committed new destination");
  check([error.localizedDescription containsString:committedBackup], "backup cleanup error exposes recovery path"); error = nil;
  SparkSetTransferTestFailures(0, NO);
  NSURL *hardlink = [root URLByAppendingPathComponent:@"copy-source-hardlink"];
  check(linkat(AT_FDCWD, copySource.fileSystemRepresentation, AT_FDCWD, hardlink.fileSystemRepresentation, 0) == 0, "create hard link");
  check(!SparkTransferPath(copySource, hardlink, SparkTransferCopy, YES, &error) && error, "hard-link alias rejects"); error = nil;
  NSURL *tree = [root URLByAppendingPathComponent:@"tree" isDirectory:YES];
  check([fm createDirectoryAtURL:tree withIntermediateDirectories:NO attributes:nil error:&error], "create source directory");
  NSURL *nested = [tree URLByAppendingPathComponent:@"nested" isDirectory:YES];
  check([fm createDirectoryAtURL:nested withIntermediateDirectories:NO attributes:nil error:&error], "create nested destination directory");
  check(!SparkTransferPath(tree, [nested URLByAppendingPathComponent:@"copy"], SparkTransferCopy, YES, &error) && error, "destination inside source rejects"); error = nil;
  NSURL *caseAlias = [root URLByAppendingPathComponent:@"TrEe" isDirectory:YES];
  struct stat treeInfo, caseAliasInfo;
  if (stat(tree.fileSystemRepresentation, &treeInfo) == 0 && stat(caseAlias.fileSystemRepresentation, &caseAliasInfo) == 0 &&
      treeInfo.st_dev == caseAliasInfo.st_dev && treeInfo.st_ino == caseAliasInfo.st_ino) {
    check(!SparkTransferPath(tree, [caseAlias URLByAppendingPathComponent:@"case-child"], SparkTransferCopy, YES, &error) && error,
      "case-variant descendant rejects on a case-insensitive volume"); error = nil;
  }
  check(!SparkTransferPath(nested, tree, SparkTransferMove, YES, &error) && error, "destination ancestor of source rejects"); error = nil;
  NSURL *aliasParent = [root URLByAppendingPathComponent:@"source-parent-alias"];
  check([fm createSymbolicLinkAtURL:aliasParent withDestinationURL:root error:&error], "create parent alias");
  NSURL *aliasedSource = [aliasParent URLByAppendingPathComponent:@"copy-source"];
  check(!SparkTransferPath(copySource, aliasedSource, SparkTransferCopy, YES, &error) && error, "symlink-parent alias rejects"); error = nil;
  NSURL *dangling = [root URLByAppendingPathComponent:@"dangling-destination"];
  check([fm createSymbolicLinkAtURL:dangling withDestinationURL:missing error:&error], "create dangling destination link");
  check(SparkTransferPath(copySource, dangling, SparkTransferCopy, YES, &error) && !error, "replacement overwrites a dangling link");
  check(SparkTransferPath(dangling, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, NO, &error) && !error, "move to an absent path");
  check(!SparkTransferPath(copySource, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, NO, &error) && error.code == NSFileWriteFileExistsError, "move conflicts with an existing destination"); error = nil;
  struct stat beforeSuccessfulMove, afterSuccessfulMove;
  check(stat(copySource.fileSystemRepresentation, &beforeSuccessfulMove) == 0, "stat successful move source");
  check(SparkTransferPath(copySource, [root URLByAppendingPathComponent:@"moved"], SparkTransferMove, YES, &error) && !error, "move replaces the destination");
  int movedStat = stat([[root URLByAppendingPathComponent:@"moved"] fileSystemRepresentation], &afterSuccessfulMove);
  check(movedStat == 0 &&
    beforeSuccessfulMove.st_ino == afterSuccessfulMove.st_ino, "same-volume move retains the source inode");
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
