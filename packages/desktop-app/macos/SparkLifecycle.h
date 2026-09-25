#import <AppKit/AppKit.h>

// Startup extensions own package-specific native chrome, never application dispatch.
// Only explicitly configured classes are instantiated, on the main thread.
@protocol SparkStartupPlugin <NSObject>
@optional
- (void)prepareApplication;
- (void)prepareMainWindow:(NSWindow *)window;
// At most one configured plugin may own root attachment. Call installRoot when
// attaching to the normal content view; otherwise retain the root in your view.
- (void)attachRootView:(NSView *)root toWindow:(NSWindow *)window installRoot:(void (^)(void))installRoot;
@end

FOUNDATION_EXPORT NSDictionary *SparkLifecycleConfiguration(void);
FOUNDATION_EXPORT void SparkPrepareApplication(void);
FOUNDATION_EXPORT void SparkPrepareMainWindow(NSWindow *window);
FOUNDATION_EXPORT void SparkAttachMainRootView(NSView *root, NSWindow *window, void (^installRoot)(void));
FOUNDATION_EXPORT void SparkRecordMainWindowShown(void);
FOUNDATION_EXPORT NSDictionary *SparkStartupTiming(void);

typedef void (^SparkQuitReply)(BOOL allow);
typedef void (^SparkQuitHandler)(SparkQuitReply reply);
// Registration, removal and replies are main-thread confined. No handlers means
// immediate quit. All registered handlers must approve; removal/timeout cancels.
FOUNDATION_EXPORT void SparkRegisterQuitHandler(NSString *identifier, SparkQuitHandler handler);
FOUNDATION_EXPORT void SparkRemoveQuitHandler(NSString *identifier);
