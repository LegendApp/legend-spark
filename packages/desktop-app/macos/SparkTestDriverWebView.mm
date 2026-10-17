#import "SparkTestDriverPrivate.h"

// Driver command `webView` (docs/test-driver.md#webviews): whether Safari's Web Inspector can attach to the WKWebView
// inside the view with a testID (WKWebView isInspectable), read from the native view, not from JavaScript. Looked up by
// class name, so RNDesktopApp needs no WebKit link. Reachable only through an authenticated driver session. Main thread.
static NSView *SparkFirstWebView(NSView *view, Class webView) {
  if ([view isKindOfClass:webView]) return view;
  for (NSView *child in view.subviews) {
    NSView *match = SparkFirstWebView(child, webView);
    if (match) return match;
  }
  return nil;
}

@interface SparkTestDriverWebView : NSObject
@end
@implementation SparkTestDriverWebView
+ (void)load {
  SparkTestDriverRegisterCommand(@"webView", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSString *testID = request[@"testID"];
    if (![testID isKindOfClass:NSString.class] || !testID.length) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"webView expects a testID")); return; }
    Class webViewClass = NSClassFromString(@"WKWebView");
    NSView *view = SparkDriverFindView(testID);
    NSView *webView = view && webViewClass ? SparkFirstWebView(view, webViewClass) : nil;
    if (!webView) { reply(SparkDriverFailure(@"E_NOT_FOUND", view ? [NSString stringWithFormat:@"No WKWebView inside %@", testID] : [NSString stringWithFormat:@"No visible view with testID %@", testID])); return; }
    NSURL *url = [webView valueForKey:@"URL"];
    reply(@{ @"ok": @YES, @"inspectable": [webView valueForKey:@"inspectable"], @"url": url.absoluteString ?: NSNull.null });
  });
}
@end
