#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cassert>
#include <memory>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeDesktopWindowManagerSpecJSI : TurboModule { NativeDesktopWindowManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
}
@interface RNDesktopWindows : NSObject
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
@interface TestSurface : NSObject
- (void)stop;
@end
@implementation TestSurface
- (void)stop {}
@end
@interface RCTSurfaceHostingView : NSView
@property TestSurface *surface;
@end
@implementation RCTSurfaceHostingView @end
static NSMutableArray *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event]; }
static NSString *SparkNamespace() { return @"window-tests"; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
// ACTUAL_IMPLEMENTATION
@interface TestWindow : NSObject
@property (weak) id<NSWindowDelegate> delegate;
@property NSView *contentView;
@property NSWindow *sheetParent;
@property NSWindow *parentWindow;
@property NSRect frame;
@property BOOL closed;
- (void)close;
@end
@implementation TestWindow
- (void)close { self.closed = YES; [self.delegate windowWillClose:[NSNotification notificationWithName:NSWindowWillCloseNotification object:self]]; }
@end
static void Pump() { for (int i=0; i<20; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]]; }
int main() { @autoreleasepool {
  events = [NSMutableArray new]; windows = LegendWindowRegistry.sharedRegistry.windows;
  TestWindow *window = [TestWindow new]; windows[@"editor"] = (NSWindow *)window;
  RNDesktopWindows *api = [RNDesktopWindows new];
  __block NSString *result = nil, *failure = nil;
  auto call = ^(NSString *method, NSDictionary *args) {
    [api call:method args:SparkJSON(args) resolve:^(id value) { result = value; } reject:^(NSString *code, NSString *, NSError *) { failure = code; }]; Pump();
  };
  call(@"closeGuard", @{ @"id": @"editor", @"enabled": @YES, @"guardId": @"guard" }); assert(!failure);
  NSString *instance = delegates[@"editor"].instanceId;
  result = nil; call(@"close", @{ @"id": @"editor" }); assert(!result && !window.closed);
  NSDictionary *request = events.lastObject; assert([request[@"type"] isEqual:@"beforeClose"]); assert([request[@"instanceId"] isEqual:instance]);
  call(@"replyClose", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"requestId": request[@"requestId"], @"allow": @NO });
  assert(!window.closed); assert(delegates[@"editor"].closeWaiters.count == 0);
  __block NSString *closedResult = nil;
  [api call:@"close" args:SparkJSON(@{ @"id": @"editor" }) resolve:^(id value) { closedResult = value; } reject:^(NSString *, NSString *, NSError *) { assert(false); }]; Pump();
  request = events.lastObject;
  call(@"replyClose", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"requestId": request[@"requestId"], @"allow": @YES });
  assert(window.closed); assert([closedResult isEqual:@"{\"closed\":true}"]); assert(!windows[@"editor"]);
  TestWindow *replacement = [TestWindow new]; windows[@"editor"] = (NSWindow *)replacement;
  failure = nil; call(@"closeGuard", @{ @"id": @"editor", @"instanceId": instance, @"guardId": @"guard", @"enabled": @NO });
  assert([failure isEqual:@"E_NOT_FOUND"]); assert(![delegates[@"editor"].instanceId isEqual:instance]);
  puts("Window guards passed");
} }
