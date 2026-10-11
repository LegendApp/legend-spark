// Sparkle-to-Spark mapping shared by the module and tests/sparkle-updater.m,
// which exercises it against the real Sparkle framework.
#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>

// Sparkle 2.9.6 (pinned in the podspec) stores "Skip This Version" in the host's
// defaults (SPUSkippedUpdate.m); its API is private. A minor skip stores the
// skipped CFBundleVersion; a major-upgrade skip stores the item's
// minimumAutoupdateVersion plus the skipped CFBundleVersion.
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
// Sparkle also aborts with SUNoUpdateError after updaterDidNotFindUpdate, which Spark already reports as notAvailable.
static inline BOOL SparkReportsAbort(NSError *error) { return !([error.domain isEqual:SUSparkleErrorDomain] && error.code == SUNoUpdateError); }
