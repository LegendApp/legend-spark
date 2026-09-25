#import "SparkLifecycle.h"
@interface SparkQuitCoordinator : NSObject
- (instancetype)initWithReply:(SparkQuitReply)reply timeout:(NSTimeInterval)timeout;
- (void)registerHandler:(NSString *)identifier handler:(SparkQuitHandler)handler;
- (void)removeHandler:(NSString *)identifier;
- (NSApplicationTerminateReply)requestQuit;
@end
