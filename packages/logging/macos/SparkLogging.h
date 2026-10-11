#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// The logging core, free of React Native so tests/logging.native.mm drives it directly.
// It owns one serial queue: entries, configuration, flushes and exports run on it in submission order.
@interface SparkLog : NSObject
// `subsystem` names the unified log subsystem; `directory` is the default log file folder.
- (instancetype)initWithSubsystem:(NSString *)subsystem directory:(NSString *)directory NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
// Entries submitted but not yet written past which new entries are dropped and counted. Default 10,000.
@property (atomic) NSInteger maxPendingEntries;
// Called on the log queue when entries start failing to reach the file ({ code, message, dropped: 1 }) and
// when writing works again ({ code, message, dropped, recovered: YES }). Codes are SparkDesktopErrorCode values.
@property (atomic, copy, nullable) void (^failureHandler)(NSDictionary *event);

// Thread-safe and returns at once. Sends the entry to the unified log (the message private unless
// `publicMessage`, the fields always private) and appends it to the current file as one JSON line,
// rotating first when the line would pass maxFileBytes. `fields` is a JSON object or empty.
- (void)log:(double)time level:(NSString *)level category:(NSString *)category message:(NSString *)message fields:(NSString *)fields publicMessage:(BOOL)publicMessage;
// Runs `block` on the log queue after every earlier entry. The methods below are only called inside it.
- (void)perform:(dispatch_block_t)block;

// { level?, files?: null | { directory?, maxFileBytes?, maxFiles? } }, validated by the caller.
// Omitted keys keep their value; files: null stops file logging; a files group merges into the current one.
- (BOOL)configure:(NSDictionary *)options error:(NSError **)error;
// The first failure since the last call, with userInfo[@"dropped"] counting the entries not written; or nil.
- (nullable NSError *)takeWriteError;
// { path, bytes, modifiedAt } for app.log, then app.1.log and so on, oldest last; empty when files are off.
- (NSArray<NSDictionary *> *)files;
// { level, files: null | { directory, maxFileBytes, maxFiles } }
- (NSDictionary *)configuration;
// Zips diagnostics.json (app, system and logging details plus `info`) and the log files into `path`,
// replacing a regular file there; a folder or symbolic link there is refused. Local only: nothing is
// sent anywhere. Returns { path, bytes, entries }.
- (nullable NSDictionary *)exportDiagnosticsTo:(NSString *)path info:(nullable NSDictionary *)info error:(NSError **)error;
@end

// The Spark error code for a failure from this core.
FOUNDATION_EXPORT NSString *SparkLogErrorCode(NSError *error);

NS_ASSUME_NONNULL_END
