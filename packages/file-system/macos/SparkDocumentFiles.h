#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
// NSFileVersion-backed document versions and Finder locking. Errors use SparkFileIntegrationErrorDomain
// codes or Cocoa/POSIX errors mapped by SparkDesktopErrorCode.

/** Saved versions other than the current file, newest first: { id, name, modifiedAt (Unix ms) }. */
FOUNDATION_EXPORT NSArray<NSDictionary *> * _Nullable SparkListFileVersions(NSURL *url, NSError **error);
/** Records the file's current contents as a version (coordinated read). Volumes without a revision store reject with E_UNAVAILABLE. */
FOUNDATION_EXPORT NSDictionary * _Nullable SparkAddFileVersion(NSURL *url, NSError **error);
/** UTF-8 contents of version id. The revision store is readable only while its NSFileVersion lives (in the App Sandbox
    the version holds the sandbox's access to it), so the version is looked up and read in one call. */
FOUNDATION_EXPORT NSString * _Nullable SparkReadFileVersion(NSURL *url, NSString *identifier, NSError **error);
/** Inside one coordinated write: records the current contents as a version, then replaces the file with version id. */
FOUNDATION_EXPORT BOOL SparkRestoreFileVersion(NSURL *url, NSString *identifier, NSError **error);
/** { locked: Finder lock (user immutable), writable: the process may replace the file and its volume is writable }. */
FOUNDATION_EXPORT NSDictionary * _Nullable SparkDocumentFileState(NSURL *url, NSError **error);
FOUNDATION_EXPORT BOOL SparkSetFileLocked(NSURL *url, BOOL locked, NSError **error);
NS_ASSUME_NONNULL_END
