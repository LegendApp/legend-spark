#import "SparkLifecycle.h"
@interface SparkQuitCoordinator : NSObject
- (instancetype)initWithReply:(SparkQuitReply)reply timeout:(NSTimeInterval)timeout;
- (void)registerHandler:(NSString *)identifier handler:(SparkQuitHandler)handler;
- (void)removeHandler:(NSString *)identifier;
// Observe the current pending attempt, or the next request when none is pending.
- (void)observeDecision:(SparkQuitReply)observer;
- (NSApplicationTerminateReply)requestQuit;
@end
