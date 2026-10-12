#import "SparkDevTools.h"

#if RCT_DEV
#import <Carbon/Carbon.h>
#import <React/RCTLog.h>

static NSURL *_Nullable (^SparkBundleURL)(void);
static id SparkDevToolsShortcut;

NSString *SparkDevToolsTargetTitle(NSString *runtime) {
  // Keep in sync with RCTHostInspectorTitle in packages/config-plugin/devtools-targets.cjs.
  NSString *app = NSBundle.mainBundle.infoDictionary[(NSString *)kCFBundleNameKey];
  return [NSString stringWithFormat:@"%@ (%@)", app, runtime ? [@"isolated runtime: " stringByAppendingString:runtime] : @"shared runtime"];
}

// The server React Native's inspector connects to (RCTInspectorDevServerHelper getServerHost).
static NSURL *SparkDevServer(void) {
  NSURL *bundle = SparkBundleURL ? SparkBundleURL() : nil;
  if (![@[@"http", @"https"] containsObject:bundle.scheme.lowercaseString ?: @""]) return nil;
  NSURLComponents *server = [NSURLComponents new];
  server.scheme = bundle.scheme;
  server.host = bundle.host ?: @"localhost";
  NSString *port = NSProcessInfo.processInfo.environment[@"RCT_METRO_PORT"];
  server.port = bundle.port ?: (port.length ? @(port.intValue) : @8081);
  return server.URL;
}

void SparkInstallDevTools(NSURL *(^bundleURL)(void)) {
  NSCAssert(NSThread.isMainThread, @"DevTools setup is main-thread confined");
  SparkBundleURL = [bundleURL copy];
  if (SparkDevToolsShortcut) return;
  // The I key by position, so ⌥⌘I works in every keyboard layout.
  SparkDevToolsShortcut = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
    NSEventModifierFlags modifiers = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl | NSEventModifierFlagShift);
    if (event.keyCode != kVK_ANSI_I || modifiers != (NSEventModifierFlagCommand | NSEventModifierFlagOption)) return event;
    if (!event.isARepeat) SparkOpenDevTools(nil, ^(NSString *code, NSString *message) { if (code) RCTLogWarn(@"%@", message); });
    return nil;
  }];
}

void SparkOpenDevTools(NSString *runtime, void (^completion)(NSString *code, NSString *message)) {
  NSCAssert(NSThread.isMainThread, @"SparkOpenDevTools is main-thread confined");
  NSURL *server = SparkDevServer();
  if (!server) { completion(@"E_UNAVAILABLE", @"React Native DevTools needs JavaScript loaded from a development server"); return; }
  NSString *title = SparkDevToolsTargetTitle(runtime), *app = NSBundle.mainBundle.bundleIdentifier;
  NSMutableURLRequest *list = [NSMutableURLRequest requestWithURL:[server URLByAppendingPathComponent:@"json/list"]];
  list.timeoutInterval = 10;
  [[NSURLSession.sharedSession dataTaskWithRequest:list completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    NSString *target = nil, *code = nil, *message = nil;
    id targets = !error && [(NSHTTPURLResponse *)response statusCode] == 200 ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    if (![targets isKindOfClass:NSArray.class]) {
      code = @"E_UNAVAILABLE";
      message = [NSString stringWithFormat:@"The development server at %@ did not list debug targets: %@", server, error.localizedDescription ?: @"unexpected response"];
    } else {
      // The server lists the most recently connected target last; prefer it, as the server does.
      for (NSDictionary *item in targets)
        if ([item isKindOfClass:NSDictionary.class] && [item[@"appId"] isEqual:app] && [item[@"title"] isEqual:title] && [item[@"id"] isKindOfClass:NSString.class]) target = item[@"id"];
      if (!target) { code = @"E_NOT_FOUND"; message = [NSString stringWithFormat:@"No debug target \"%@\" is connected to %@", title, server]; }
    }
    if (target) {
      NSURLComponents *open = [NSURLComponents componentsWithURL:[server URLByAppendingPathComponent:@"open-debugger"] resolvingAgainstBaseURL:NO];
      open.queryItems = @[[NSURLQueryItem queryItemWithName:@"target" value:target]];
      NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:open.URL];
      request.HTTPMethod = @"POST";
      [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *body, NSURLResponse *reply, NSError *failure) {
        // A failed launch is answered with an error status. After a successful launch React Native's default
        // browser launcher never answers (it waits for an event child processes do not emit), so that
        // request times out; Expo's `j` key treats the timeout as success too.
        NSInteger status = [(NSHTTPURLResponse *)reply statusCode];
        if (failure ? failure.code != NSURLErrorTimedOut : status < 200 || status >= 300)
          RCTLogWarn(@"React Native DevTools did not open for \"%@\": %@", title, failure.localizedDescription ?: [NSString stringWithFormat:@"HTTP %ld", (long)status]);
      }] resume];
    }
    dispatch_async(dispatch_get_main_queue(), ^{ completion(code, message); });
  }] resume];
}
#endif
