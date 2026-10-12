#import <Foundation/Foundation.h>

// System state beyond power and appearance: Rosetta, time zone, Low Power Mode, thermal state,
// network path and proxies, and their change events (docs/system.md). Main thread only.

// Fields merged into getSystemInfo(), including driver-mode overrides of `onBattery`. nil with `error` set
// when the OS reports a value outside the contract.
FOUNDATION_EXPORT NSDictionary *SparkSystemStateInfo(NSString **error);
// The current network path and system proxies. Exactly one of `status` and `error` is non-nil; `code` is a
// Spark error code. Runs once on the main queue, within `timeout` seconds.
FOUNDATION_EXPORT void SparkSystemNetworkStatus(NSTimeInterval timeout, void (^completion)(NSDictionary *status, NSString *code, NSString *error));

// The system event observers one module instance owns. Each OS source is installed only while an
// observed event type needs it, so a reload's invalidated instance never removes a newer instance's sources.
// In a driver run none is installed: only simulateSystemEvent's events arrive.
@interface SparkSystemStateObserver : NSObject
// Installs the sources `types` needs and removes the others. NO, with `error` set and the previous
// sources kept, when a source cannot be created.
- (BOOL)observeTypes:(NSSet<NSString *> *)types error:(NSString **)error;
- (void)stop;
@end
