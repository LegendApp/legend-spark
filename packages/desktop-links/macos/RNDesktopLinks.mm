#import "RNDesktopLinks.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include "../common/AuthLoopback.h"
#include <map>
#include <memory>
@implementation RNDesktopLinks {
  std::map<std::string, std::unique_ptr<spark::AuthLoopback>> _authSessions;
}
RCT_EXPORT_MODULE(NativeDesktopLinks)
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    if ([method hasPrefix:@"auth"] || [method hasPrefix:@"crypto"]) {
      try {
        NSString *identifier = args[@"id"] ?: @"";
        std::string key(identifier.UTF8String);
        if ([method isEqual:@"cryptoRandom"]) {
          NSInteger count = [args[@"count"] integerValue]; if (count < 1 || count > 1024) throw std::invalid_argument("Random byte count must be 1–1024");
          NSMutableData *bytes = [NSMutableData dataWithLength:count];
          if (SecRandomCopyBytes(kSecRandomDefault, count, bytes.mutableBytes) != errSecSuccess) throw std::runtime_error("Secure random generation failed");
          resolve(SparkJSON([bytes base64EncodedStringWithOptions:0]));
        } else if ([method isEqual:@"cryptoDigest"]) {
          NSData *data = [args[@"value"] dataUsingEncoding:NSUTF8StringEncoding];
          if (!data || data.length > 1048576) throw std::invalid_argument("Digest input exceeds 1 MiB");
          unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
          NSMutableString *hex = [NSMutableString new]; for (unsigned char byte : digest) [hex appendFormat:@"%02x", byte]; resolve(SparkJSON(hex));
        } else if ([method isEqual:@"authPrepare"]) {
          if (key.empty() || _authSessions.count(key) || _authSessions.size() >= 4) throw std::invalid_argument("Invalid or busy auth session");
          NSInteger port = [args[@"port"] integerValue]; if (port < 0 || port > 65535) throw std::invalid_argument("Invalid callback port");
          auto receiver = std::make_unique<spark::AuthLoopback>((unsigned short)port, std::string([args[@"path"] UTF8String]), [identifier](std::string value) {
            NSString *url = [NSString stringWithUTF8String:value.c_str()];
            dispatch_async(dispatch_get_main_queue(), ^{ SparkEmit(@{ @"type": @"authRedirect", @"id": identifier, @"url": url }); });
          });
          NSString *uri = [NSString stringWithUTF8String:receiver->RedirectURI().c_str()]; _authSessions.emplace(key, std::move(receiver)); resolve(SparkJSON(uri));
        } else if ([method isEqual:@"authClose"]) { _authSessions.erase(key); resolve(@"null"); }
        else throw std::invalid_argument("Unknown auth operation");
      } catch (std::exception const &error) { reject(@"E_AUTH", [NSString stringWithUTF8String:error.what()], nil); }
      return;
    }
    if ([method isEqual:@"recent"]) {
      NSArray *result = [NSUserDefaults.standardUserDefaults arrayForKey:[SparkNamespace() stringByAppendingString:@".recentDocuments"]] ?: @[];
      NSMutableArray *paths = [NSMutableArray new];
      for (NSString *value in result) { NSURL *url = [NSURL URLWithString:value]; if (!url.isFileURL || !url.path.length) { reject(@"E_INVALID_DATA", @"Invalid recent document URL", nil); return; } [paths addObject:url.path]; }
      resolve(SparkJSON(paths)); return;
    }
    if ([method isEqual:@"clearRecent"]) {
      [NSUserDefaults.standardUserDefaults removeObjectForKey:[SparkNamespace() stringByAppendingString:@".recentDocuments"]];
      if (![SparkContext()[@"runtime"][@"mode"] isEqual:@"go"]) [NSDocumentController.sharedDocumentController clearRecentDocuments:nil];
      resolve(@"null"); return;
    }
    NSURL *url = ([method isEqual:@"noteRecent"] || [method isEqual:@"openPath"]) ? [NSURL fileURLWithPath:args[@"path"]] : [NSURL URLWithString:args[@"url"] ?: @""];
    if (!url.scheme.length) { SparkInvalid(reject, @"URL must have a scheme"); return; }
    if ([method isEqual:@"canOpen"]) resolve(SparkJSON(@([NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url] != nil)));
    else if ([method isEqual:@"open"] || [method isEqual:@"openPath"]) {
      // Opening a URL can deliver an Apple event back to this app. Keep its
      // main run loop free while LaunchServices resolves and opens the target.
      [NSWorkspace.sharedWorkspace openURL:url configuration:NSWorkspaceOpenConfiguration.configuration
        completionHandler:^(NSRunningApplication *application, NSError *error) {
          if (error) reject(@"E_OPEN_URL", error.localizedDescription, error);
          else resolve(@"null");
        }];
    } else if ([method isEqual:@"noteRecent"]) {
      if (!url.isFileURL) { SparkInvalid(reject, @"Recent documents must be file URLs"); return; }
      NSString *key = [SparkNamespace() stringByAppendingString:@".recentDocuments"];
      NSMutableArray *recent = [[NSUserDefaults.standardUserDefaults arrayForKey:key] mutableCopy] ?: [NSMutableArray new];
      [recent removeObject:url.absoluteString]; [recent insertObject:url.absoluteString atIndex:0];
      if (recent.count > 20) [recent removeLastObject];
      [NSUserDefaults.standardUserDefaults setObject:recent forKey:key];
      if (![SparkContext()[@"runtime"][@"mode"] isEqual:@"go"]) [NSDocumentController.sharedDocumentController noteNewRecentDocumentURL:url];
      resolve(@"null");
    } else SparkInvalid(reject, @"Unknown links operation");
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ self->_authSessions.clear(); }); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopLinksSpecJSI>(params);
}
@end
