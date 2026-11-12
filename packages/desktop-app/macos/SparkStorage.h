#import <Foundation/Foundation.h>

BOOL SparkMigrateStorage(NSURL *destination, NSArray<NSURL *> *legacyDirectories,
  NSString *bundleIdentifier, NSString *configuredIdentifier, NSError **error);
