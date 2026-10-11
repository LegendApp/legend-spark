#import <Foundation/Foundation.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import "SparkMotionCoordinator.h"

// The in-app test driver's virtual clock (docs/motion.md#virtual-clock-for-the-test-driver).
// Commands: {"command": "setClock", "mode": "virtual" | "real"} and
// {"command": "advanceClock", "durationMs": n}. Both reply {"ok": true, "mode", "timeMs"}.
// They are reachable only through an authenticated driver session.
static SparkMotionReject SparkMotionDriverFailure(SparkTestDriverReply reply)
{
  return ^(NSString *code, NSString *message) { reply(@{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } }); };
}
static SparkMotionResolve SparkMotionDriverSuccess(SparkTestDriverReply reply)
{
  return ^(id) {
    [SparkMotionCoordinator.shared clock:^(NSString *json) {
      NSMutableDictionary *result = [[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] mutableCopy];
      result[@"ok"] = @YES;
      reply(result);
    }];
  };
}

@interface SparkMotionDriver : NSObject
@end
@implementation SparkMotionDriver
+ (void)load
{
  SparkTestDriverRegisterCommand(@"setClock", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id mode = request[@"mode"];
    if (![mode isKindOfClass:NSString.class]) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"setClock expects mode real or virtual"); return; }
    [SparkMotionCoordinator.shared setClock:mode resolve:SparkMotionDriverSuccess(reply) reject:SparkMotionDriverFailure(reply)];
  });
  SparkTestDriverRegisterCommand(@"advanceClock", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id duration = request[@"durationMs"];
    if (![duration isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)duration) == CFBooleanGetTypeID()) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"advanceClock expects durationMs"); return; }
    [SparkMotionCoordinator.shared advanceClock:[duration doubleValue] resolve:SparkMotionDriverSuccess(reply) reject:SparkMotionDriverFailure(reply)];
  });
}
@end
