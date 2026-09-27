#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <CoreGraphics/CoreGraphics.h>
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>
#include <memory>
#include <cmath>
#include <cassert>
#define RCT_EXPORT_MODULE(...)
static void RCTExecuteOnMainQueue(dispatch_block_t block) { block(); }
@interface RCTUIView : NSView
@property NSColor *backgroundColor;
@end
@implementation RCTUIView @end
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeWindowManagerSpecJSI : TurboModule { NativeWindowManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
namespace ReactMarker { struct StartupLogger {
 static StartupLogger& getInstance() { static StartupLogger value; return value; }
 double getAppStartupStartTime() { return NAN; }
 double getInitReactRuntimeStartTime() { return NAN; }
 double getRunJSBundleStartTime() { return NAN; }
 double getRunJSBundleEndTime() { return NAN; }
 double getInitReactRuntimeEndTime() { return NAN; }
 double getAppStartupEndTime() { return NAN; }
}; }
}
@interface RCTBridge : NSObject @end
@implementation RCTBridge @end
@interface RCTEventEmitter : NSObject
@property RCTBridge *bridge;
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(id)body {}
- (void)invalidate {}
@end
@interface RCTRootViewFactory : NSObject
- (NSView *)viewWithModuleName:(NSString *)name initialProperties:(NSDictionary *)props;
@end
@implementation RCTRootViewFactory
- (NSView *)viewWithModuleName:(NSString *)name initialProperties:(NSDictionary *)props { return nil; }
@end
@interface RCTRootView : RCTUIView
- (instancetype)initWithBridge:(RCTBridge *)bridge moduleName:(NSString *)name initialProperties:(NSDictionary *)props;
@end
@implementation RCTRootView
- (instancetype)initWithBridge:(RCTBridge *)bridge moduleName:(NSString *)name initialProperties:(NSDictionary *)props { return [super init]; }
@end
@interface RNWindowManager : RCTEventEmitter
+ (NSWindow *)getMainWindow;
@end
static NSMutableArray *events;
NSString *const SparkDesktopEvent = @"desktop";
void SparkEmit(NSDictionary *event) { [events addObject:event]; }
NSDictionary *SparkStartupTiming() { return @{}; }
NSDictionary *SparkLifecycleConfiguration() { return @{}; }
extern "C" void SparkRebindWindowDelegate(NSWindow *, NSString *, id<NSWindowDelegate>) {}
// ACTUAL_IMPLEMENTATION
extern "C" void LegendPrepareSidebarSplitViewStartup(NSWindow *, NSDictionary *) {}
extern "C" BOOL LegendAttachSidebarSplitViewStartupRoot(NSWindow *, NSView *, void (^)(void)) { return NO; }
extern "C" void LegendFinishSidebarSplitViewStartup(NSWindow *) {}
int main() { @autoreleasepool {
  events = [NSMutableArray new];
  RNWindowManager *manager = [RNWindowManager new];
  NSSlider *slider = [NSSlider sliderWithValue:0.375 minValue:0 maxValue:1 target:nil action:nil];
  objc_setAssociatedObject(slider, &LegendToolbarControlMetadataKey, @{ @"windowIdentifier": @"editor", @"instanceId": @"instance", @"itemId": @"menu", @"value": @"volume" }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [manager toolbarMenuSliderChanged:slider];
  NSDictionary *event = events.lastObject;
  assert([event[@"type"] isEqual:@"toolbarMenuAction"]);
  assert([event[@"instanceId"] isEqual:@"instance"]);
  assert([event[@"action"][@"type"] isEqual:@"valueChanged"]);
  assert([event[@"action"][@"itemId"] isEqual:@"volume"]);
  assert([event[@"action"][@"value"] doubleValue] == 0.375);
  NSSegmentedControl *segment = [[NSSegmentedControl alloc] initWithFrame:NSZeroRect]; segment.segmentCount = 1; segment.selectedSegment = 0;
  objc_setAssociatedObject(segment, &LegendToolbarControlMetadataKey, @{ @"windowIdentifier": @"editor", @"instanceId": @"instance", @"itemId": @"segment", @"values": @[@""] }, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [manager toolbarSegmentedControlChanged:segment];
  assert([events.lastObject[@"type"] isEqual:@"toolbarSelectionChanged"]);
  assert([events.lastObject[@"value"] isEqual:@""]);
  __block NSString *error = nil;
  [manager setWindowOptions:@"missing" optionsJson:@"{}" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { error = code; }];
  assert([error isEqual:@"E_NOT_FOUND"]); assert(!manager.windowOptions[@"missing"]);
  puts("Window manager controls passed");
} }
