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
@property NSMutableSet<UNNotificationCategory *> *categories;
@property (weak) id<UNUserNotificationCenterDelegate> previous;
+ (instancetype)shared;
@end
@implementation SparkNotificationCenter
+ (instancetype)shared {
  static SparkNotificationCenter *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    instance = [SparkNotificationCenter new]; instance.responses = [NSMutableArray new]; instance.categories = [NSMutableSet new];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    instance.previous = center.delegate; center.delegate = instance;
    [center getNotificationCategoriesWithCompletionHandler:^(NSSet<UNNotificationCategory *> *categories) {
      [instance.categories addObjectsFromArray:categories.allObjects];
      [instance.categories addObject:[UNNotificationCategory categoryWithIdentifier:@"spark.desktop.default" actions:@[] intentIdentifiers:@[] options:UNNotificationCategoryOptionCustomDismissAction]];
      [center setNotificationCategories:instance.categories];
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
  NSString *action = @"open";
  if ([response.actionIdentifier isEqual:UNNotificationDismissActionIdentifier]) action = @"dismiss";
  else if ([response.actionIdentifier hasPrefix:@"spark.action."]) action = [response.actionIdentifier substringFromIndex:@"spark.action.".length];
  NSDictionary *event = @{ @"type": @"notificationResponse", @"id": NSUUID.UUID.UUIDString,
    @"notificationId": info[@"sparkId"] ?: @"", @"data": info[@"sparkData"] ?: @{},
    @"action": action };
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
      NSArray *actions = [args[@"actions"] isKindOfClass:NSArray.class] ? args[@"actions"] : nil;
      content.title = args[@"title"]; content.body = args[@"body"] ?: @""; content.subtitle = args[@"subtitle"] ?: @"";
      // JS normalizes sound to "none", "default", or a tone name. macOS user
      // notification sounds must ship in the app bundle or Library/Sounds, so
      // tones present the platform default here; Windows maps tones to system sounds.
      NSString *sound = [args[@"sound"] isKindOfClass:NSString.class] ? args[@"sound"] : nil;
      if (sound.length > 0 && ![sound isEqual:@"none"]) content.sound = UNNotificationSound.defaultSound;
      content.categoryIdentifier = @"spark.desktop.default";
      if (actions.count > 0) {
        // Categories are app-global; namespace identifiers so Spark registrations
        // never collide with a host app's own UNNotificationCategory set.
        NSMutableArray<UNNotificationAction *> *categoryActions = [NSMutableArray new];
        NSMutableString *signature = [NSMutableString stringWithString:@"spark.actions."];
        for (NSDictionary *action in actions) {
          if (![action[@"id"] isKindOfClass:NSString.class] || ![action[@"label"] isKindOfClass:NSString.class]) { SparkInvalid(reject, @"Notification actions need an id and label"); return; }
          [categoryActions addObject:[UNNotificationAction actionWithIdentifier:[@"spark.action." stringByAppendingString:action[@"id"]] title:action[@"label"] options:UNNotificationActionOptionNone]];
          [signature appendFormat:@"%@:%@|", action[@"id"], action[@"label"]];
        }
        content.categoryIdentifier = signature;
        UNNotificationCategory *category = [UNNotificationCategory categoryWithIdentifier:signature actions:categoryActions intentIdentifiers:@[] options:UNNotificationCategoryOptionCustomDismissAction];
        if (![delegate.categories containsObject:category]) {
          [delegate.categories addObject:category];
          [center setNotificationCategories:delegate.categories];
        }
      }
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
