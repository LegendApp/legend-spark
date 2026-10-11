#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A main-thread hang, delivered on the main queue once the main thread answers again:
 * { durationMs, thresholdMs, startedAt, stack: [{ address, image?, imageAddress?, imageOffset?, imageUUID?, symbol?, symbolOffset? }] }.
 * Addresses are hex strings; startedAt is wall-clock milliseconds since 1970.
 */
typedef void (^SparkHangHandler)(NSDictionary *report);

/**
 * A watchdog thread pings the main queue. When a ping goes unanswered for the threshold, it suspends
 * the main thread just long enough to walk its frame pointers, then waits for the answer and reports
 * the hang with the time it took. It holds no lock the main thread takes, and exits after stop.
 */
@interface SparkHangWatchdog : NSObject
/** Starts the watchdog thread; call it on the main thread (it raises otherwise). `handler` runs on the main queue, never after stop. */
- (instancetype)initWithThreshold:(NSUInteger)thresholdMs handler:(SparkHangHandler)handler NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
/** Stops reporting at once; the thread exits within 100 ms and releases the watchdog. */
- (void)stop;
@end

/** Blocks the calling thread for `milliseconds` (the module calls it on the main thread to test reporting). */
FOUNDATION_EXPORT void SparkSimulateHang(NSUInteger milliseconds);

NS_ASSUME_NONNULL_END
