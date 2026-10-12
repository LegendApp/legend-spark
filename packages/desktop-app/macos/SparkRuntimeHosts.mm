#import "SparkRuntimeHosts.h"
#if RCT_DEV
#import <objc/message.h>

NSArray<NSString *> *SparkIsolatedRuntimeNames(void) {
  Class runtimes = NSClassFromString(@"ThreadedRuntime");
  SEL names = NSSelectorFromString(@"runtimeNames");
  return [runtimes respondsToSelector:names] ? ((NSArray *(*)(id, SEL))objc_msgSend)(runtimes, names) : @[];
}

id SparkRuntimeHost(NSString *isolated) {
  id host = nil;
  if (!isolated) {
    // RCTAppDelegate (the Spark host's AppDelegate) owns the main runtime's host.
    @try { host = [(NSObject *)NSApp.delegate valueForKeyPath:@"rootViewFactory.reactHost"]; } @catch (NSException *) { return nil; }
  } else {
    // ensureHostWithRuntimeName: (pinned @react-native-runtimes/core) creates a host for an unknown name, so ask only for
    // a runtime that is running; for one, it returns the existing host.
    SEL lookup = NSSelectorFromString(@"ensureHostWithRuntimeName:");
    Class runtimes = NSClassFromString(@"ThreadedRuntime");
    if (![runtimes respondsToSelector:lookup] || ![SparkIsolatedRuntimeNames() containsObject:isolated]) return nil;
    host = ((id (*)(id, SEL, NSString *))objc_msgSend)(runtimes, lookup, isolated);
  }
  return [host respondsToSelector:NSSelectorFromString(@"moduleRegistry")] ? host : nil;
}
#endif
