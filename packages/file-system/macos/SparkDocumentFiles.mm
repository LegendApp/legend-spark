#import "SparkDocumentFiles.h"
#import "SparkFileIntegration.h"
#import <sys/stat.h>
#import <unistd.h>
#import <errno.h>

static NSError *Coded(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkFileIntegrationErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
static BOOL Fail(NSError **error, NSError *value) { if (error) *error = value; return NO; }
static BOOL Exists(NSURL *url, NSError **error) {
  struct stat info;
  if (lstat(url.fileSystemRepresentation, &info) == 0) return YES;
  return Fail(error, [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil]);
}
// The revision store keys versions by document ID, which needs volume persistent IDs (APFS, HFS+).
static BOOL KeepsVersions(NSURL *url, NSError **error) {
  NSNumber *supported = nil;
  if (![url getResourceValue:&supported forKey:NSURLVolumeSupportsPersistentIDsKey error:error]) return NO;
  return supported.boolValue ?: Fail(error, Coded(@"E_UNAVAILABLE", @"This volume does not keep document versions"));
}
// A version's id is its file name in the revision store (a UUID), stable for the life of the version.
static NSFileVersion *VersionFor(NSURL *url, NSString *identifier, NSError **error) {
  if (![identifier isKindOfClass:NSString.class] || !identifier.length || [identifier containsString:@"/"]) return Fail(error, Coded(@"E_INVALID_ARGUMENT", @"Invalid document version id")), nil;
  for (NSFileVersion *version in [NSFileVersion otherVersionsOfItemAtURL:url] ?: @[]) if ([version.URL.lastPathComponent isEqual:identifier]) return version;
  return Fail(error, Coded(@"E_NOT_FOUND", @"The document has no version with this id")), nil;
}
static NSDictionary *Describe(NSFileVersion *version, NSError **error) {
  NSString *identifier = version.URL.lastPathComponent;
  if (!identifier.length) return Fail(error, Coded(@"E_NATIVE", @"A document version has no stored file")), nil;
  return @{ @"id": identifier, @"name": version.localizedName ?: @"",
    @"modifiedAt": @(floor(version.modificationDate.timeIntervalSince1970 * 1000)) };
}
static NSDictionary *Add(NSURL *url, NSError **error) {
  if (!KeepsVersions(url, error)) return nil;
  NSFileVersion *version = [NSFileVersion addVersionOfItemAtURL:url withContentsOfURL:url options:0 error:error];
  return version ? Describe(version, error) : nil;
}

NSArray<NSDictionary *> *SparkListFileVersions(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSArray<NSFileVersion *> *versions = [[NSFileVersion otherVersionsOfItemAtURL:url] ?: @[] sortedArrayUsingComparator:^(NSFileVersion *a, NSFileVersion *b) {
    return [b.modificationDate compare:a.modificationDate];
  }];
  NSMutableArray *result = [NSMutableArray arrayWithCapacity:versions.count];
  for (NSFileVersion *version in versions) {
    NSDictionary *value = Describe(version, error);
    if (!value) return nil;
    [result addObject:value];
  }
  return result;
}

NSDictionary *SparkAddFileVersion(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  __block NSDictionary *result = nil;
  SparkCoordinate(SparkCoordinateRead, url, nil, error, ^BOOL(NSURL *item, NSURL *unused, NSError **failure) { return (result = Add(item, failure)) != nil; });
  return result;
}

NSString *SparkReadFileVersion(NSURL *url, NSString *identifier, NSError **error) {
  if (!Exists(url, error)) return nil;
  // Precise lifetime: releasing the version revokes a sandboxed process's access to its stored file.
  __attribute__((objc_precise_lifetime)) NSFileVersion *version = VersionFor(url, identifier, error);
  return version ? [NSString stringWithContentsOfURL:version.URL encoding:NSUTF8StringEncoding error:error] : nil;
}

BOOL SparkRestoreFileVersion(NSURL *url, NSString *identifier, NSError **error) {
  if (!Exists(url, error)) return NO;
  NSFileVersion *version = VersionFor(url, identifier, error);
  if (!version) return NO;
  return SparkCoordinate(SparkCoordinateWrite, url, nil, error, ^BOOL(NSURL *item, NSURL *unused, NSError **failure) {
    // Restoring is reversible: the replaced contents stay in the version list.
    return Add(item, failure) && [version replaceItemAtURL:item options:0 error:failure] != nil;
  });
}

NSDictionary *SparkDocumentFileState(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSDictionary *values = [url resourceValuesForKeys:@[NSURLIsUserImmutableKey, NSURLVolumeIsReadOnlyKey] error:error];
  if (!values) return nil;
  // Saving replaces the file atomically, which needs write access to the file and its folder.
  BOOL writable = ![values[NSURLVolumeIsReadOnlyKey] boolValue] && access(url.fileSystemRepresentation, W_OK) == 0
    && access(url.URLByDeletingLastPathComponent.fileSystemRepresentation, W_OK) == 0;
  return @{ @"locked": @([values[NSURLIsUserImmutableKey] boolValue]), @"writable": @(writable) };
}

BOOL SparkSetFileLocked(NSURL *url, BOOL locked, NSError **error) {
  if (!Exists(url, error)) return NO;
  return [url setResourceValue:@(locked) forKey:NSURLIsUserImmutableKey error:error];
}
