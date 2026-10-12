#import <AppKit/AppKit.h>

// The share picker, a Services provider and Core Spotlight indexing for @legendapp/spark/sharing (docs/sharing.md).
// No React: tests/sharing.native.mm drives it directly. Main thread only; every completion runs once, on the main thread.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver. It records what
// would be shared and indexed, answers the share picker with a configured choice, takes the declared services from the
// driver instead of Info.plist, and never shows a picker, sets the Services provider or writes the Spotlight index.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkSharingErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_NOT_FOUND, E_UNAVAILABLE, E_UNSUPPORTED_OPTION, E_BUSY, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkSharingErrorCode(NSError *error);
// The selector every Spark service declares as NSMessage; its NSUserData is the service's name.
FOUNDATION_EXPORT NSString *const SparkServiceMessage;

// Share items from the wire format: { type: "text", text } | { type: "url", url } | { type: "file", path }.
// Files must exist (E_NOT_FOUND). Returns NSString, NSURL and file NSURL objects for the picker.
FOUNDATION_EXPORT NSArray *_Nullable SparkShareItems(NSArray *items, NSError **error);
// The Spark services an Info.plist declares: name -> NSServices entry. Entries for other selectors are skipped.
FOUNDATION_EXPORT NSDictionary<NSString *, NSDictionary *> *SparkDeclaredServices(NSDictionary *info);
// A CSSearchableItem attribute dictionary from { id, title, domain?, description?, keywords?, expiresAt? } (validated).
FOUNDATION_EXPORT NSDictionary *_Nullable SparkSpotlightItem(id item, NSError **error);

// service: the title of the service the person chose, nil when they dismissed the picker.
typedef void (^SparkShareCompletion)(NSString *_Nullable service, NSError *_Nullable error);
typedef void (^SparkSharingCompletion)(NSError *_Nullable error);
// A service invocation: { name, text (NSNull without), files: [path], urls: [url] }.
typedef void (^SparkServiceHandler)(NSDictionary *invocation);

@interface SparkSharing : NSObject
// `info` is the Info.plist dictionary whose NSServices declare the app's services.
- (instancetype)initWithInfo:(NSDictionary *)info simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;

// Shows the share picker relative to `view` (the window content when nil) and completes once the person picks a
// service or dismisses it. One picker at a time (E_BUSY). Without a view, the key or main window is used (E_UNAVAILABLE without one).
- (void)share:(NSArray *)items view:(nullable NSView *)view completion:(SparkShareCompletion)completion;

// Called for each invocation of a registered service.
@property (nonatomic, copy, nullable) SparkServiceHandler serviceHandler;
// Registers a declared service; the first registration makes this object NSApp.servicesProvider. Services that return
// data (NSReturnTypes) are E_UNSUPPORTED_OPTION: AppKit needs their answer before the call returns, and handlers are asynchronous.
- (BOOL)registerService:(NSString *)name error:(NSError **)error;
- (void)unregisterService:(NSString *)name;
// The Services provider method AppKit calls (NSMessage sparkService).
- (void)sparkService:(NSPasteboard *)pasteboard userData:(NSString *)name error:(NSString *_Nullable *_Nonnull)message;

// Adds or replaces items in the app's Core Spotlight index; items are the wire dictionaries SparkSpotlightItem validates.
- (void)index:(NSArray *)items completion:(SparkSharingCompletion)completion;
// Exactly one of `identifiers` and `domains`, or neither to delete every item.
- (void)deleteIdentifiers:(nullable NSArray<NSString *> *)identifiers domains:(nullable NSArray<NSString *> *)domains completion:(SparkSharingCompletion)completion;

#if SPARK_TEST_DRIVER
// Simulated instances only. `answer` is how the simulated picker answers: a service title, "dismiss", or NSNull to
// fail the share (E_UNAVAILABLE); `services` replaces the declared services (names); nil leaves either unchanged.
- (BOOL)simulateAnswer:(nullable id)answer services:(nullable NSArray<NSString *> *)services error:(NSError **)error;
// Runs a registered service as the Services menu would, with `text` on a private pasteboard.
- (BOOL)invokeService:(NSString *)name text:(NSString *)text error:(NSError **)error;
// { shares: [{ items, anchored, service }], indexed: { id: attributes }, services: [names], registered: [names], invocations }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
