#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#include <cassert>

typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
@interface RNDesktopNotifications : NSObject
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
static NSDictionary *SparkContext(void) { return @{}; }
static NSString *SparkNamespace(void) { return @"fixture"; }
static void SparkEmit(NSDictionary *) {}
static NSDictionary *SparkArgs(NSString *value) { return [NSJSONSerialization JSONObjectWithData:[value dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static void SparkReject(RCTPromiseRejectBlock reject, NSError *error) { reject(@"E_NATIVE", error.localizedDescription, error); }

@interface FakeSettings : NSObject
@property (readonly) UNAuthorizationStatus authorizationStatus;
@end
@implementation FakeSettings
- (UNAuthorizationStatus)authorizationStatus { return UNAuthorizationStatusAuthorized; }
@end

@interface FakeCenter : NSObject
@property (weak) id delegate;
@property (copy) void (^categoryCallback)(NSSet<UNNotificationCategory *> *);
@property NSMutableArray<NSSet<UNNotificationCategory *> *> *published;
@property NSMutableArray<UNNotificationRequest *> *requests;
+ (instancetype)currentNotificationCenter;
- (void)getNotificationCategoriesWithCompletionHandler:(void (^)(NSSet<UNNotificationCategory *> *))completion;
- (void)setNotificationCategories:(NSSet<UNNotificationCategory *> *)categories;
- (void)getNotificationSettingsWithCompletionHandler:(void (^)(UNNotificationSettings *))completion;
- (void)requestAuthorizationWithOptions:(UNAuthorizationOptions)options completionHandler:(void (^)(BOOL, NSError *))completion;
- (void)addNotificationRequest:(UNNotificationRequest *)request withCompletionHandler:(void (^)(NSError *))completion;
- (void)removePendingNotificationRequestsWithIdentifiers:(NSArray *)ids;
- (void)removeDeliveredNotificationsWithIdentifiers:(NSArray *)ids;
- (void)getPendingNotificationRequestsWithCompletionHandler:(void (^)(NSArray<UNNotificationRequest *> *))completion;
- (void)getDeliveredNotificationsWithCompletionHandler:(void (^)(NSArray<UNNotification *> *))completion;
@end
@implementation FakeCenter
+ (instancetype)currentNotificationCenter {
  static FakeCenter *center; static dispatch_once_t once;
  dispatch_once(&once, ^{ center = [FakeCenter new]; center.published = [NSMutableArray new]; center.requests = [NSMutableArray new]; });
  return center;
}
- (void)getNotificationCategoriesWithCompletionHandler:(void (^)(NSSet<UNNotificationCategory *> *))completion { self.categoryCallback = completion; }
- (void)setNotificationCategories:(NSSet<UNNotificationCategory *> *)categories {
  assert(NSThread.isMainThread);
  assert(![categories isKindOfClass:NSMutableSet.class]);
  [self.published addObject:categories];
}
- (void)getNotificationSettingsWithCompletionHandler:(void (^)(UNNotificationSettings *))completion { completion((UNNotificationSettings *)(id)[FakeSettings new]); }
- (void)requestAuthorizationWithOptions:(UNAuthorizationOptions)options completionHandler:(void (^)(BOOL, NSError *))completion { completion(YES, nil); }
- (void)addNotificationRequest:(UNNotificationRequest *)request withCompletionHandler:(void (^)(NSError *))completion {
  assert(NSThread.isMainThread);
  BOOL registered = NO;
  for (UNNotificationCategory *category in self.published.lastObject) if ([category.identifier isEqual:request.content.categoryIdentifier]) registered = YES;
  assert(registered);
  [self.requests addObject:request]; completion(nil);
}
- (void)removePendingNotificationRequestsWithIdentifiers:(NSArray *)ids {}
- (void)removeDeliveredNotificationsWithIdentifiers:(NSArray *)ids {}
- (void)getPendingNotificationRequestsWithCompletionHandler:(void (^)(NSArray<UNNotificationRequest *> *))completion { completion(@[]); }
- (void)getDeliveredNotificationsWithCompletionHandler:(void (^)(NSArray<UNNotification *> *))completion { completion(@[]); }
@end
@protocol FakeCenterDelegate <NSObject>
- (void)userNotificationCenter:(FakeCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion;
- (void)userNotificationCenter:(FakeCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))completion;
@end
#define UNUserNotificationCenter FakeCenter
#define UNUserNotificationCenterDelegate FakeCenterDelegate
// ACTUAL_IMPLEMENTATION

static void Wait(BOOL (^condition)(void)) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3];
  while (!condition() && deadline.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  assert(condition());
}
int main() { @autoreleasepool {
  FakeCenter *center = FakeCenter.currentNotificationCenter;
  [SparkNotificationCenter shared];
  RNDesktopNotifications *module = [RNDesktopNotifications new];
  __block int resolved = 0;
  RCTPromiseResolveBlock resolve = ^(id) { resolved++; };
  RCTPromiseRejectBlock reject = ^(NSString *, NSString *, NSError *) { assert(false); };
  for (int i = 0; i < 2; ++i) {
    NSString *args = SparkJSON(@{ @"id": @(i).stringValue, @"title": @"Hello", @"actions": @[@{ @"id": @"reply", @"label": [NSString stringWithFormat:@"Reply %d", i] }] });
    [module call:@"show" args:args resolve:resolve reject:reject];
  }
  __block BOOL queued = NO;
  dispatch_async(dispatch_get_main_queue(), ^{ queued = YES; });
  Wait(^BOOL { return queued; });
  assert(center.requests.count == 0 && center.published.count == 0);
  NSSet *host = [NSSet setWithObject:[UNNotificationCategory categoryWithIdentifier:@"host.existing" actions:@[] intentIdentifiers:@[] options:0]];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ assert(!NSThread.isMainThread); center.categoryCallback(host); });
  Wait(^BOOL { return resolved == 2; });
  assert(center.published.firstObject.count == 2 && center.published.lastObject.count == 4);
  assert([center.published.lastObject containsObject:host.anyObject]);
  [module call:@"show" args:SparkJSON(@{ @"id": @"silent", @"title": @"Ready" }) resolve:resolve reject:reject];
  Wait(^BOOL { return resolved == 3; });
  assert(center.requests.count == 3 && center.published.count == 3);
  assert(center.published.firstObject.count == 2);
  puts("Notification categories passed");
} }
