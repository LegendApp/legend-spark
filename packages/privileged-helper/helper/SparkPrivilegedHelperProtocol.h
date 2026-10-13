#import <Foundation/Foundation.h>
#import <Security/Security.h>

// The XPC contract between an app's @legendapp/spark/privileged-helper calls and its privileged helper
// (docs/privileged-helper.md). The app side is packages/privileged-helper/macos; the helper side is
// SparkPrivilegedHelperService.m, which the app's helper compiles in.
//
// Each side checks the other's code signature: the helper accepts only clients that satisfy
// SparkPrivilegedHelperRequirement(its own team, the app's bundle identifier), and the app talks only to a helper that
// satisfies SparkPrivilegedHelperRequirement(its own team, nil). An unsigned or ad-hoc signed process has no team, so
// neither side can build a requirement and both refuse to run.

NS_ASSUME_NONNULL_BEGIN

// One request: a JSON message (UTF-8, at most SparkPrivilegedHelperMaxMessageBytes) and, when the app passed an admin
// authorization, its AuthorizationExternalForm. The reply carries JSON, or a SparkErrorCode and message from the helper.
@protocol SparkPrivilegedHelperProtocol
// The app's first message on every connection, with nothing in it. The system checks the helper's code signature when
// its reply arrives (NSXPCConnection checks the peer on receipt, not before sending), so the app sends messages and
// authorizations only once this reply has proved the helper is the app's.
- (void)verifyWithReply:(void (^)(void))reply;
- (void)handleMessage:(NSData *)message authorization:(nullable NSData *)authorization reply:(void (^)(NSData *_Nullable reply, NSString *_Nullable errorCode, NSString *_Nullable errorMessage))reply;
@end

static const NSUInteger SparkPrivilegedHelperMaxMessageBytes = 1024 * 1024;
// The right an admin authorization holds and the helper checks.
#define SparkPrivilegedHelperRight "system.privilege.admin"

// The team identifier this process is signed with, or nil when it is unsigned or ad-hoc signed.
static inline NSString *_Nullable SparkPrivilegedHelperSigningTeam(void)
{
  SecCodeRef code = NULL;
  SecStaticCodeRef staticCode = NULL;
  CFDictionaryRef information = NULL;
  NSString *team = nil;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) == errSecSuccess && SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &staticCode) == errSecSuccess
      && SecCodeCopySigningInformation(staticCode, kSecCSSigningInformation, &information) == errSecSuccess) {
    id value = ((__bridge NSDictionary *)information)[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    if ([value isKindOfClass:NSString.class] && [value length]) team = value;
  }
  if (information) CFRelease(information);
  if (staticCode) CFRelease(staticCode);
  if (code) CFRelease(code);
  return team;
}

// A code signing requirement for code signed by `team` through Apple's certificate chain (Developer ID or Apple
// Development), with the signing identifier `identifier` when given. nil when either would not be a literal: a team is
// ten uppercase letters or digits, an identifier reverse-DNS characters only, so neither can inject requirement syntax.
static inline NSString *_Nullable SparkPrivilegedHelperRequirement(NSString *_Nullable team, NSString *_Nullable identifier)
{
  NSCharacterSet *teamCharacters = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
  NSCharacterSet *identifierCharacters = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_"];
  if (team.length != 10 || [team rangeOfCharacterFromSet:teamCharacters.invertedSet].location != NSNotFound) return nil;
  if (identifier && (!identifier.length || identifier.length > 255 || [identifier rangeOfCharacterFromSet:identifierCharacters.invertedSet].location != NSNotFound)) return nil;
  NSString *requirement = [NSString stringWithFormat:@"anchor apple generic and certificate leaf[subject.OU] = \"%@\"", team];
  return identifier ? [requirement stringByAppendingFormat:@" and identifier \"%@\"", identifier] : requirement;
}

NS_ASSUME_NONNULL_END
