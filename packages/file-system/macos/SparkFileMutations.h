#import <Foundation/Foundation.h>

enum SparkTransferKind {
  SparkTransferCopy,
  SparkTransferMove,
};

// A false result with no error means conflict/absence respectively.
BOOL SparkWriteTextIfUnchanged(NSURL *url, NSString *expected, NSString *text, NSError **error);
BOOL SparkRemoveFile(NSURL *url, BOOL recursive, NSError **error);
/** Copies or moves, replacing the destination only when overwrite is set. An existing destination otherwise conflicts with NSFileWriteFileExistsError, including a dangling link. */
BOOL SparkTransferPath(NSURL *from, NSURL *to, SparkTransferKind kind, BOOL overwrite, NSError **error);
