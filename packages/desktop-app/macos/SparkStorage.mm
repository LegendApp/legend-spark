#import "SparkStorage.h"
#import <sys/stdio.h>
#import <errno.h>

static NSString * const SparkStorageOwnerFile = @".spark-bundle-identifier";
static BOOL SparkStorageFail(NSError **error, NSString *message) {
  if (error) *error = [NSError errorWithDomain:@"SparkStorage" code:1 userInfo:@{ NSLocalizedDescriptionKey: message }];
  return NO;
}
static BOOL SparkStorageDirectory(NSURL *url, BOOL *exists, NSError **error) {
  NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:url.path error:error];
  if (!attributes) {
    if ([(*error).domain isEqual:NSCocoaErrorDomain] && ((*error).code == NSFileNoSuchFileError || (*error).code == NSFileReadNoSuchFileError)) { *error = nil; *exists = NO; return YES; }
    return NO;
  }
  *exists = YES;
  return [attributes[NSFileType] isEqual:NSFileTypeDirectory] || SparkStorageFail(error, [@"Expected a storage directory, not a file or symlink: " stringByAppendingString:url.path]);
}
static NSString *SparkStorageOwner(NSURL *directory, NSError **error) {
  NSURL *marker = [directory URLByAppendingPathComponent:SparkStorageOwnerFile];
  NSString *owner = [NSString stringWithContentsOfURL:marker encoding:NSUTF8StringEncoding error:error];
  if (!owner && [(*error).domain isEqual:NSCocoaErrorDomain] && (*error).code == NSFileReadNoSuchFileError) *error = nil;
  if (owner && !owner.length) SparkStorageFail(error, [@"Invalid storage owner marker: " stringByAppendingString:marker.path]);
  return owner;
}
static BOOL SparkStorageClaim(NSURL *directory, NSString *bundleIdentifier, NSError **error) {
  NSString *owner = SparkStorageOwner(directory, error);
  if (*error) return NO;
  if (!owner) {
    NSFileManager *fm = NSFileManager.defaultManager;
    NSURL *marker = [directory URLByAppendingPathComponent:SparkStorageOwnerFile];
    NSURL *temporary = [directory URLByAppendingPathComponent:[@".spark-owner-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    NSData *data = [bundleIdentifier dataUsingEncoding:NSUTF8StringEncoding];
    if (![data writeToURL:temporary options:NSDataWritingAtomic error:error]) return NO;
    // Link a complete marker without replacing a concurrent owner's claim.
    BOOL claimed = [fm linkItemAtURL:temporary toURL:marker error:error];
    NSError *cleanup;
    if (![fm removeItemAtURL:temporary error:&cleanup]) NSLog(@"Unable to remove storage owner staging file %@: %@", temporary.path, cleanup);
    if (claimed) owner = bundleIdentifier;
    else {
      if (![(*error).domain isEqual:NSCocoaErrorDomain] || (*error).code != NSFileWriteFileExistsError) return NO;
      *error = nil;
      owner = SparkStorageOwner(directory, error);
      if (*error) return NO;
    }
  }
  return [owner isEqual:bundleIdentifier] || SparkStorageFail(error, [@"Storage belongs to another bundle: " stringByAppendingString:directory.path]);
}
BOOL SparkMigrateStorage(NSURL *destination, NSArray<NSURL *> *legacyDirectories,
  NSString *bundleIdentifier, NSString *configuredIdentifier, NSError **error) {
  NSError *__autoreleasing failure = nil;
  if (!error) error = &failure;
  *error = nil;
  NSFileManager *fm = NSFileManager.defaultManager;
  BOOL exists;
  if (!SparkStorageDirectory(destination, &exists, error)) return NO;
  if (exists) return SparkStorageClaim(destination, bundleIdentifier, error);
  NSURL *source = nil;
  for (NSURL *legacy in legacyDirectories) {
    if ([legacy isEqual:destination]) continue;
    if (!SparkStorageDirectory(legacy, &exists, error)) return NO;
    if (!exists) continue;
    NSString *owner = SparkStorageOwner(legacy, error);
    if (*error) return NO;
    if (!owner && !configuredIdentifier.length)
      return SparkStorageFail(error, @"Unmarked storage needs SparkDefaultBundleIdentifier from a rebuilt custom host, or macos.bundleIdentifier supplied by the current Go CLI. Configure/rebuild the app or migrate explicitly.");
    if (owner ? ![owner isEqual:bundleIdentifier] : ![configuredIdentifier isEqual:bundleIdentifier]) continue;
    if (source) return SparkStorageFail(error, @"Multiple legacy storage directories need migration. Resolve them explicitly before launching the app.");
    source = legacy;
  }
  if (![fm createDirectoryAtURL:destination.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:error]) return NO;
  if (!source) return [fm createDirectoryAtURL:destination withIntermediateDirectories:NO attributes:nil error:error] && SparkStorageClaim(destination, bundleIdentifier, error);
  if ([destination.path hasPrefix:[source.path stringByAppendingString:@"/"]])
    return SparkStorageFail(error, @"Legacy storage contains the destination. Resolve its data layout explicitly before launching the app.");
  if (!SparkStorageClaim(source, bundleIdentifier, error)) return NO;
  // Both paths are in Application Support. Rename the owned folder atomically so
  // clearing the new store cannot resurrect an old snapshot on the next launch.
  if (renamex_np(source.fileSystemRepresentation, destination.fileSystemRepresentation, RENAME_EXCL) == 0) return YES;
  int code = errno;
  *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:@{ NSFilePathErrorKey: source.path }];
  return NO;
}
