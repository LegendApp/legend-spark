#import "RNDesktopNotifications.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <UserNotifications/UserNotifications.h>

static NSString * const NamespaceKey = @"sparkProject";
static NSString *Permission(UNNotificationSettings *settings) {
  switch (settings.authorizationStatus) {
    case UNAuthorizationStatusNotDetermined: return @"notDetermined";
    case UNAuthorizationStatusDenied: return @"denied";
    case UNAuthorizationStatusAuthorized: return @"authorized";
    case UNAuthorizationStatusProvisional: return @"provisional";
    default: return @"unknown";
  }
}
static NSString *Identifier(NSString *value) { return [NSString stringWithFormat:@"%@:%@", SparkNamespace(), value]; }
static BOOL Owns(UNNotificationRequest *request) { return [request.content.userInfo[NamespaceKey] isEqual:SparkNamespace()]; }
@interface SparkNotificationCenter : NSObject <UNUserNotificationCenterDelegate>
@property NSMutableArray *responses;
@property (weak) id<UNUserNotificationCenterDelegate> previous;
+ (instancetype)shared;
@end
@implementation SparkNotificationCenter
+ (instancetype)shared {
  static SparkNotificationCenter *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    instance = [SparkNotificationCenter new]; instance.responses = [NSMutableArray new];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    instance.previous = center.delegate; center.delegate = instance;
    [center getNotificationCategoriesWithCompletionHandler:^(NSSet<UNNotificationCategory *> *categories) {
      NSMutableSet *combined = [categories mutableCopy];
      [combined addObject:[UNNotificationCategory categoryWithIdentifier:@"spark.desktop.default" actions:@[] intentIdentifiers:@[] options:UNNotificationCategoryOptionCustomDismissAction]];
      [center setNotificationCategories:combined];
    }];
  });
  return instance;
}
+ (void)load {
  // Install before launch finishes, including when a notification launches the app.
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { [self shared]; }];
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
  if (Owns(notification.request)) completion(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
  else if ([self.previous respondsToSelector:_cmd]) [self.previous userNotificationCenter:center willPresentNotification:notification withCompletionHandler:completion];
  else completion(UNNotificationPresentationOptionNone);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))completion {
  if (!Owns(response.notification.request)) {
    if ([self.previous respondsToSelector:_cmd]) [self.previous userNotificationCenter:center didReceiveNotificationResponse:response withCompletionHandler:completion];
    else completion();
    return;
  }
  NSDictionary *info = response.notification.request.content.userInfo;
  NSDictionary *event = @{ @"type": @"notificationResponse", @"id": NSUUID.UUID.UUIDString,
    @"notificationId": info[@"sparkId"] ?: @"", @"data": info[@"sparkData"] ?: @{},
    @"action": [response.actionIdentifier isEqual:UNNotificationDismissActionIdentifier] ? @"dismiss" : @"open" };
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.responses addObject:event]; if (self.responses.count > 100) [self.responses removeObjectAtIndex:0];
    SparkEmit(event); completion();
  });
}
@end

@implementation RNDesktopNotifications
RCT_EXPORT_MODULE(NativeDesktopNotifications)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    SparkNotificationCenter *delegate = [SparkNotificationCenter shared];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"permission"] || [method isEqual:@"requestPermission"]) {
      void (^read)(void) = ^{ [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) { resolve(SparkJSON(Permission(settings))); }]; };
      if ([method isEqual:@"permission"]) read();
      else [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound completionHandler:^(BOOL granted, NSError *error) { if (error) SparkReject(reject, error); else read(); }];
    } else if ([method isEqual:@"show"]) {
      if (![args[@"id"] isKindOfClass:NSString.class] || ![args[@"title"] isKindOfClass:NSString.class]) { SparkInvalid(reject, @"Notification needs an id and title"); return; }
      UNMutableNotificationContent *content = [UNMutableNotificationContent new];
      content.categoryIdentifier = @"spark.desktop.default";
      content.title = args[@"title"]; content.body = args[@"body"] ?: @""; content.subtitle = args[@"subtitle"] ?: @"";
      if ([args[@"sound"] boolValue]) content.sound = UNNotificationSound.defaultSound;
      content.userInfo = @{ NamespaceKey: SparkNamespace(), @"sparkId": args[@"id"], @"sparkData": args[@"data"] ?: @{} };
      UNNotificationTrigger *trigger = args[@"delay"] ? [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:[args[@"delay"] doubleValue] repeats:NO] : nil;
      UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:Identifier(args[@"id"]) content:content trigger:trigger];
      [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        if (settings.authorizationStatus != UNAuthorizationStatusAuthorized && settings.authorizationStatus != UNAuthorizationStatusProvisional) { reject(@"E_PERMISSION_DENIED", @"Request notification permission from a user action before showing notifications", nil); return; }
        [center addNotificationRequest:request withCompletionHandler:^(NSError *error) { if (error) SparkReject(reject, error); else resolve(@"null"); }];
      }];
    } else if ([method isEqual:@"cancel"] || [method isEqual:@"dismiss"]) {
      NSArray *ids = @[Identifier(args[@"id"])];
      if ([method isEqual:@"cancel"]) [center removePendingNotificationRequestsWithIdentifiers:ids];
      else [center removeDeliveredNotificationsWithIdentifiers:ids];
      resolve(@"null");
    } else if ([method isEqual:@"pending"] || [method isEqual:@"cancelAll"]) {
      [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests) {
        NSMutableArray *ids = [NSMutableArray new], *nativeIds = [NSMutableArray new];
        for (UNNotificationRequest *request in requests) if (Owns(request)) { [ids addObject:request.content.userInfo[@"sparkId"]]; [nativeIds addObject:request.identifier]; }
        if ([method isEqual:@"cancelAll"]) { [center removePendingNotificationRequestsWithIdentifiers:nativeIds]; resolve(@"null"); }
        else resolve(SparkJSON(ids));
      }];
    } else if ([method isEqual:@"delivered"] || [method isEqual:@"dismissAll"]) {
      [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *notifications) {
        NSMutableArray *ids = [NSMutableArray new], *nativeIds = [NSMutableArray new];
        for (UNNotification *notification in notifications) if (Owns(notification.request)) { [ids addObject:notification.request.content.userInfo[@"sparkId"]]; [nativeIds addObject:notification.request.identifier]; }
        if ([method isEqual:@"dismissAll"]) { [center removeDeliveredNotificationsWithIdentifiers:nativeIds]; resolve(@"null"); }
        else resolve(SparkJSON(ids));
      }];
    } else if ([method isEqual:@"responses"]) resolve(SparkJSON([delegate.responses copy]));
    else SparkInvalid(reject, @"Unknown notification operation");
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopNotificationsSpecJSI>(params); }
@end
