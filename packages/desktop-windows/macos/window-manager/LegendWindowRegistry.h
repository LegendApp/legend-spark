#import <TargetConditionals.h>
#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <objc/runtime.h>

// Windows and their React surfaces outlive an individual TurboModule on reload.
// Runtime-specific listeners and delegates remain owned by RNWindowManager.
@interface LegendWindowRegistry : NSObject
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSWindow *> *windows;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, id> *rootViews;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSString *> *moduleNames;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSArray<NSTitlebarAccessoryViewController *> *> *titlebarAccessoryControllers;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSView *> *titlebarMaterialViews;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSArray<NSDictionary *> *> *toolbarItemConfigs;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, CIFilter *> *windowBlurFilters;
@property (nonatomic, readonly) NSMutableDictionary<NSString *, NSDictionary *> *windowOptions;
@property (nonatomic, readonly) NSMutableSet<NSString *> *closeRequestIdentifiers;
+ (instancetype)sharedRegistry;
@end

// Test driver mode (docs/test-driver.md) never orders a window on screen: the driver renders
// windows in-process. Each window remembers whether the app has shown it, so the window API
// still reports it as visible or hidden. The host sets this for the main window too.
static inline void SparkSetDriverShown(NSWindow *window, BOOL shown) {
  objc_setAssociatedObject(window, NSSelectorFromString(@"sparkDriverShown"), shown ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
static inline BOOL SparkDriverShown(NSWindow *window) { return [objc_getAssociatedObject(window, NSSelectorFromString(@"sparkDriverShown")) boolValue]; }
#endif
