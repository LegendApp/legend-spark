#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

// The operations of @legendapp/spark/clipboard against one pasteboard (docs/clipboard.md). The pasteboard is a
// parameter, never looked up here: the module passes the general pasteboard, while driver mode and the native tests
// pass a private named pasteboard, so tests never read or replace the user's clipboard (docs/clipboard.md#testing).
//
// Main thread, except -answer:, which the JavaScript thread calls while the main thread waits for promised data.
// Events go to `emit` on the main thread: {type: "clipboardChanged", changeCount}, {type: "clipboardProvide", id,
// requestId, dataType} and {type: "clipboardProviderReleased", id}.
typedef void (^SparkClipboardEmit)(NSDictionary *event);
FOUNDATION_EXPORT NSString *const SparkClipboardErrorDomain; // userInfo[@"code"] is the SparkError code

@interface SparkClipboard : NSObject
- (instancetype)initWithPasteboard:(NSPasteboard *)pasteboard emit:(SparkClipboardEmit)emit NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (readonly) NSPasteboard *pasteboard;
// getString, setString, hasString, formats, clear, changeCount, read, write, writePromised, observe, unobserve.
// `binary` keeps image bytes as NSData in read results; otherwise the result is JSON text.
- (nullable id)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary error:(NSError **)error;
// Data for the promised-data request `requestId`, or nil when the provider failed. NO with E_TIMEOUT once the
// request is no longer waiting, or E_INVALID_DATA for a PNG AppKit cannot decode (the paste then gets nothing).
- (BOOL)answer:(NSInteger)requestId data:(nullable NSData *)data error:(NSError **)error;
// Stops change polling and answers every later promised-data request with nothing at once (module teardown).
- (void)invalidate;
@end

NS_ASSUME_NONNULL_END
