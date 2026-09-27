#import "RNDesktopSecureStorage.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <Security/Security.h>

static NSDictionary *Failure(NSString *code, NSString *message) {
  return @{ @"error": @{ @"code": code, @"message": message } };
}
static NSDictionary *StorageOperation(NSString *method, NSDictionary *args) {
  NSString *key = args[@"key"];
  if (![key isKindOfClass:NSString.class] || !key.length || key.length > 200) return Failure(@"E_INVALID_ARGUMENT", @"Expected a Keychain key of 1–200 characters");
  NSString *service = SparkNamespace();
  NSMutableDictionary *query = [@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: key } mutableCopy];
  OSStatus status;
  if ([method isEqual:@"get"]) {
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) return @{ @"value": NSNull.null };
    if (status == errSecSuccess) {
      NSData *data = CFBridgingRelease(result);
      NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      return value ? @{ @"value": value } : Failure(@"E_KEYCHAIN", @"Keychain item is not valid UTF-8");
    }
  } else if ([method isEqual:@"set"]) {
    if (![args[@"value"] isKindOfClass:NSString.class]) return Failure(@"E_INVALID_ARGUMENT", @"Expected a string value");
    NSData *value = [args[@"value"] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *attributes = @{ (__bridge id)kSecValueData: value };
    status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
    if (status == errSecItemNotFound) {
      [query addEntriesFromDictionary:attributes];
      query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
      status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
      if (status == errSecDuplicateItem) {
        [query removeObjectForKey:(__bridge id)kSecValueData];
        [query removeObjectForKey:(__bridge id)kSecAttrAccessible];
        status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
      }
    }
  } else if ([method isEqual:@"remove"]) {
    status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status == errSecItemNotFound) status = errSecSuccess;
  } else return Failure(@"E_INVALID_ARGUMENT", @"Unknown Keychain operation");
  if (status == errSecSuccess) return @{ @"value": NSNull.null };
  NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, NULL));
  return Failure(@"E_KEYCHAIN", [NSString stringWithFormat:@"Keychain error %d: %@", (int)status, message ?: @"Unknown error"]);
}
@implementation RNDesktopSecureStorage
RCT_EXPORT_MODULE(NativeDesktopSecureStorage)
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSDictionary *result = StorageOperation(method, SparkArgs(json));
    NSDictionary *error = result[@"error"];
    if (error) reject(error[@"code"], error[@"message"], nil);
    else resolve(SparkJSON(result[@"value"]));
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopSecureStorageSpecJSI>(params);
}
@end
