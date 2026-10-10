#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/** Error domain for integration failures whose Spark code is chosen explicitly. userInfo[@"code"] is the Spark code. */
FOUNDATION_EXPORT NSString * const SparkFileIntegrationErrorDomain;

/** YES when this process runs in the App Sandbox. */
FOUNDATION_EXPORT BOOL SparkIsSandboxed(void);
/** Sandboxed processes need com.apple.security.files.bookmarks.app-scope; without it these reject with E_UNAVAILABLE. */
FOUNDATION_EXPORT NSData * _Nullable SparkCreateBookmark(NSURL *url, BOOL readOnly, NSError **error);
FOUNDATION_EXPORT NSURL * _Nullable SparkResolveBookmark(NSData *data, BOOL *stale, NSError **error);

/** "granted", "denied", or "indeterminate" when sandboxed (the sandbox's EPERM hides TCC's answer). nil with error when no protected probe exists or a probe fails unexpectedly. */
FOUNDATION_EXPORT NSString * _Nullable SparkFullDiskAccessStatus(NSArray<NSString *> *probes, BOOL sandboxed, NSError **error);
FOUNDATION_EXPORT NSArray<NSString *> *SparkFullDiskAccessProbes(void);

FOUNDATION_EXPORT NSArray<NSDictionary *> * _Nullable SparkApplicationsForFile(NSURL *url, NSError **error);
FOUNDATION_EXPORT NSURL * _Nullable SparkApplicationURL(NSString *path, NSError **error);

FOUNDATION_EXPORT NSData * _Nullable SparkFileIconPNG(NSURL *url, NSInteger pixels, NSError **error);
FOUNDATION_EXPORT void SparkThumbnailPNG(NSURL *url, NSInteger pixels, void (^completion)(NSData * _Nullable png, NSError * _Nullable error));

FOUNDATION_EXPORT NSArray<NSString *> * _Nullable SparkListExtendedAttributes(NSURL *url, NSError **error);
/** Returns NSNull when the attribute is absent. */
FOUNDATION_EXPORT id _Nullable SparkGetExtendedAttribute(NSURL *url, NSString *name, NSError **error);
FOUNDATION_EXPORT BOOL SparkSetExtendedAttribute(NSURL *url, NSString *name, NSData *value, NSError **error);
/** Absence is success. */
FOUNDATION_EXPORT BOOL SparkRemoveExtendedAttribute(NSURL *url, NSString *name, NSError **error);

/** Returns NSNull when the item is not quarantined. Keys: agentName, originURL, dataURL, timestamp (Unix ms). */
FOUNDATION_EXPORT id _Nullable SparkGetQuarantine(NSURL *url, NSError **error);
FOUNDATION_EXPORT BOOL SparkSetQuarantine(NSURL *url, NSDictionary *info, NSError **error);
FOUNDATION_EXPORT BOOL SparkClearQuarantine(NSURL *url, NSError **error);

FOUNDATION_EXPORT NSDictionary * _Nullable SparkDiskSpace(NSURL *url, NSError **error);

typedef NS_ENUM(NSInteger, SparkCoordination) { SparkCoordinateRead, SparkCoordinateWrite, SparkCoordinateDelete, SparkCoordinateCopy, SparkCoordinateMove };
/** Runs accessor inside an NSFileCoordinator claim. to is required for copy/move. */
FOUNDATION_EXPORT BOOL SparkCoordinate(SparkCoordination kind, NSURL *url, NSURL * _Nullable to, NSError **error, BOOL (^accessor)(NSURL *url, NSURL * _Nullable to, NSError **error));
/** Main thread only. Shows the shared Quick Look panel for existing items. */
FOUNDATION_EXPORT BOOL SparkShowQuickLook(NSArray<NSURL *> *urls, NSError **error);
NS_ASSUME_NONNULL_END
