#import <AppKit/AppKit.h>
#import "SparkDesktopError.h"
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
static dispatch_semaphore_t changes;
static NSString *lastPath;
@interface RCTEventEmitter : NSObject
- (void)sendEventWithName:(NSString *)name body:(NSDictionary *)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(NSDictionary *)body { lastPath = body[@"path"]; dispatch_semaphore_signal(changes); }
- (void)invalidate {}
@end
@interface RNDesktopFileSystem : RCTEventEmitter
- (void)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static NSString *SparkNamespace(void) { return @"spark.watch.test"; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static void SparkReject(RCTPromiseRejectBlock reject, NSError *error) { reject(SparkDesktopErrorCode(error), error.localizedDescription, error); }
