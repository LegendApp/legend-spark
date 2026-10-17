#import <Foundation/Foundation.h>
#import <React/RCTDefines.h>

// HTTP requests that Spark's native modules make themselves, listed by the shared runtime's network inspector in
// development builds (docs/devtools.md#network-inspector). Release builds compile none of the reporting.
NS_ASSUME_NONNULL_BEGIN
// Loads `request` with NSURLSession.sharedSession (dataTaskWithRequest:completionHandler:, completion on the session's
// queue). In development builds, while the inspector records, it also reports an HTTP(S) request as made by `module`
// (a package's import path, such as @"@legendapp/spark/audio").
FOUNDATION_EXPORT void SparkLoadURL(NSString *module, NSURLRequest *request, void (^completion)(NSData *_Nullable data, NSURLResponse *_Nullable response, NSError *_Nullable error));
#if RCT_DEV
// For a module with its own transport. Any thread. Reports an HTTP(S) request that is starting and returns its id, or
// nil while the inspector does not record (or for another scheme).
FOUNDATION_EXPORT NSString *_Nullable SparkNetworkRequestWillStart(NSString *module, NSURLRequest *request);
// Any thread. Reports how request `identifier` ended (a nil identifier does nothing): its response and body, or error.
FOUNDATION_EXPORT void SparkNetworkRequestDidEnd(NSString *_Nullable identifier, NSURLResponse *_Nullable response, NSData *_Nullable data, NSError *_Nullable error);
// Main thread; the shared runtime's inspector (NativeDesktopApp reportNativeNetwork): report requests, keeping the first
// `maxBodySize` bytes of each body, or stop reporting when it is negative.
FOUNDATION_EXPORT void SparkSetNetworkReporting(NSInteger maxBodySize);
#endif
NS_ASSUME_NONNULL_END
