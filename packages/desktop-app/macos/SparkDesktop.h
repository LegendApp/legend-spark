#import <AppKit/AppKit.h>
#import "SparkLifecycle.h"
#import <React/RCTBridgeModule.h>

FOUNDATION_EXPORT NSString * const SparkDesktopEvent;
// Call in applicationWillFinishLaunching:. YES: this process owns the project's
// instance. NO: another process does; this one forwards its launch and exits.
FOUNDATION_EXPORT BOOL SparkAcquireInstance(void);
// Latched on first call during launch: --spark-safe-mode, or Shift held at launch.
FOUNDATION_EXPORT BOOL SparkSafeMode(void);
// { safeMode: "flag" | "modifier" | null, relaunched: bool, instance: "primary" | "test-driver" }.
FOUNDATION_EXPORT NSDictionary *SparkLaunchState(void);
// Runs the quit guards; on approval the started instance takes over, on veto it is killed.
FOUNDATION_EXPORT void SparkRelaunch(NSArray<NSString *> *arguments, void (^completion)(NSDictionary *result, NSError *error));
FOUNDATION_EXPORT NSDictionary *SparkContext(void);
FOUNDATION_EXPORT NSDictionary *SparkInitialProps(NSString *windowID, NSDictionary *props);
FOUNDATION_EXPORT NSString *SparkNamespace(void);
FOUNDATION_EXPORT void SparkEmit(NSDictionary *event);
FOUNDATION_EXPORT void SparkOpenURLs(NSArray<NSURL *> *urls);
FOUNDATION_EXPORT NSArray *SparkPendingURLs(void);
FOUNDATION_EXPORT NSString *SparkInitialURL(void);
FOUNDATION_EXPORT void SparkMarkLaunchComplete(void);
FOUNDATION_EXPORT NSApplicationTerminateReply SparkShouldQuit(void);
FOUNDATION_EXPORT void SparkObserveQuitDecision(SparkQuitReply observer);
FOUNDATION_EXPORT void SparkSetQuitGuard(NSString *identifier, BOOL value);
FOUNDATION_EXPORT void SparkReplyQuit(NSString *identifier, BOOL allow, NSUInteger generation);
FOUNDATION_EXPORT NSString *SparkJSON(id value);
FOUNDATION_EXPORT NSDictionary *SparkArgs(NSString *json);
FOUNDATION_EXPORT void SparkReject(RCTPromiseRejectBlock reject, NSError *error);
FOUNDATION_EXPORT void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message);
FOUNDATION_EXPORT NSDictionary *SparkWindowConfiguration(void);
FOUNDATION_EXPORT void SparkApplyWindowOptions(NSWindow *window, NSDictionary *options);
FOUNDATION_EXPORT NSView *SparkWindowContent(NSView *root);
FOUNDATION_EXPORT void SparkRestoreWindow(NSWindow *window, NSString *key, NSDictionary *options);
FOUNDATION_EXPORT NSMenu *SparkDockMenu;
