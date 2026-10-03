#import <Foundation/Foundation.h>

enum SparkTransferKind {
  SparkTransferCopy,
  SparkTransferMove,
};

// A false result with no error means conflict/absence respectively.
BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error);
BOOL SparkRemoveFile(NSURL *url, BOOL recursive, NSError **error);
#if defined(SPARK_FILE_MUTATIONS_TESTING)
enum SparkTransferTestFailure {
  SparkFailStageCopy = 1 << 0,
  SparkFailPublish = 1 << 1,
  SparkFailRestoreDestination = 1 << 2,
  SparkFailRestoreSource = 1 << 3,
  SparkFailSourceRemoval = 1 << 4,
  SparkFailBackupRemoval = 1 << 5,
  SparkFailStageCleanup = 1 << 6,
};
void SparkSetTransferTestFailures(unsigned failures, BOOL forceCrossVolumeMove);
#endif
/** Copies or moves, replacing the destination only when overwrite is set. An existing destination otherwise conflicts with NSFileWriteFileExistsError, including a dangling link. Self-transfers and overlapping paths reject. Transfers stage beside the destination before publication; cross-volume moves copy then delete. A cross-volume source-cleanup failure can leave a partial source; source-cleanup and backup-cleanup errors report committed and retained paths. */
BOOL SparkTransferPath(NSURL *from, NSURL *to, SparkTransferKind kind, BOOL overwrite, NSError **error);
