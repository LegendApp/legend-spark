// Sparkle-to-Spark mapping shared by the module and tests/sparkle-updater.m,
// which exercises it against the real Sparkle framework.
#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>

// Sparkle 2.9.6 (pinned in the podspec) stores "Skip This Version" in the host's
// defaults (SPUSkippedUpdate.m); its API is private. A minor skip stores the
// skipped CFBundleVersion; a major-upgrade skip stores the item's
// minimumAutoupdateVersion plus the skipped CFBundleVersion.
static inline NSUserDefaults *SparkUpdateDefaults(NSBundle *host) {
  id domain = [host objectForInfoDictionaryKey:@"SUDefaultsDomain"];
  if (![domain isKindOfClass:NSString.class]) domain = [host isEqual:NSBundle.mainBundle] ? nil : host.bundleIdentifier;
  return domain ? [[NSUserDefaults alloc] initWithSuiteName:domain] : NSUserDefaults.standardUserDefaults;
}
static inline NSDictionary *SparkSkippedUpdates(NSUserDefaults *defaults) {
  return @{ @"skippedBuild": [defaults stringForKey:@"SUSkippedVersion"] ?: NSNull.null,
            @"skippedMajorBuild": [defaults stringForKey:@"SUSkippedMajorSubreleaseVersion"] ?: NSNull.null };
}
static inline void SparkClearSkippedUpdates(NSUserDefaults *defaults) {
  for (NSString *key in @[@"SUSkippedVersion", @"SUSkippedMajorVersion", @"SUSkippedMajorSubreleaseVersion"]) [defaults removeObjectForKey:key];
}
// `build` is the CFBundleVersion Sparkle orders, skips and selects deltas by;
// `version` is the display version. Sparkle hands willDownloadUpdate the delta
// item when it chose one and calls it again with the full item when it falls back.
static inline NSDictionary *SparkUpdateEvent(NSString *state, SUAppcastItem *item, NSError *error) {
  NSMutableDictionary *event = [@{ @"type": @"update", @"state": state } mutableCopy];
  if (item) { event[@"version"] = item.displayVersionString; event[@"build"] = item.versionString; }
  if ([state isEqual:@"downloading"]) event[@"delta"] = @(item.isDeltaUpdate);
  if ([state isEqual:@"skipped"]) event[@"major"] = @(item.isMajorUpgrade);
  if (error) event[@"message"] = error.localizedDescription;
  return event;
}
static inline NSDictionary *SparkUpdateAbortEvent(NSError *error) {
  if ([error.domain isEqual:SUSparkleErrorDomain]) {
    if (error.code == SUNoUpdateError) return nil; // Already reported by updaterDidNotFindUpdate.
    if (error.code == SUInstallationCanceledError) return SparkUpdateEvent(@"cancelled", nil, nil);
  }
  return SparkUpdateEvent(@"error", nil, error);
}
