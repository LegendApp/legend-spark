#import <AppKit/AppKit.h>
#include <cassert>
#include <memory>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeDesktopTraySpecJSI : TurboModule { NativeDesktopTraySpecJSI(ObjCTurboModule::InitParams const &) {} };
}
@interface RNDesktopTray : NSObject @end
static NSMutableArray *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event]; }
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
@interface FixtureTrayButton : NSObject
@property NSString *title;
@property NSImage *image;
@property NSString *toolTip;
@property NSCellImagePosition imagePosition;
@property id target;
@property SEL action;
@property NSString *accessibilityIdentifier;
@end
@implementation FixtureTrayButton @end
@interface FixtureStatusItem : NSObject
@property FixtureTrayButton *button;
@property NSMenu *menu;
@end
@implementation FixtureStatusItem @end
// ACTUAL_IMPLEMENTATION
int main() { @autoreleasepool {
  events = [NSMutableArray new];
  SparkTrayItem *owner = [SparkTrayItem new]; owner.identifier = @"tray"; owner.instanceId = @"new";
  [owner clicked:nil]; assert([events.lastObject[@"instanceId"] isEqual:@"new"]);
  NSMenuItem *item = [NSMenuItem new]; item.representedObject = @"open"; [owner selected:item];
  assert([events.lastObject[@"itemId"] isEqual:@"open"]); assert([events.lastObject[@"instanceId"] isEqual:@"new"]);
  RNDesktopTray *api = [RNDesktopTray new]; api.items[@"tray"] = owner;
  __block BOOL completed = NO;
  [api call:@"remove" args:@"{\"id\":\"tray\",\"instanceId\":\"old\"}" resolve:^(id) { completed = YES; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  for (int n=0; n<20 && !completed; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert(completed); assert(api.items[@"tray"] == owner);
  __block NSString *failure = nil;
  [api call:@"create" args:@"{\"id\":\"bad-image\",\"instanceId\":\"test\",\"imagePath\":\"/nonexistent/tray.png\"}" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { failure = code; }];
  for (int n=0; n<20 && !failure; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert([failure isEqual:@"E_INVALID_DATA"]); assert(!api.items[@"bad-image"]);
  FixtureStatusItem *status = [FixtureStatusItem new]; status.button = [FixtureTrayButton new];
  NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(16, 16)]; status.button.image = image;
  NSMenu *menu = [NSMenu new]; status.menu = menu; owner.item = (NSStatusItem *)status;
  owner.options = @{ @"title": @"Initial", @"imagePath": @"/nonexistent/previous-image.png", @"menu": @[ @{ @"id": @"open", @"title": @"Open" } ] };
  completed = NO;
  [api call:@"update" args:@"{\"id\":\"tray\",\"instanceId\":\"new\",\"title\":\"Changed\"}" resolve:^(id) { completed = YES; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  for (int n=0; n<20 && !completed; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert(completed); assert(status.button.image == image); assert(status.menu == menu);
  assert([status.button.title isEqual:@"Changed"]); assert([owner.options[@"imagePath"] isEqual:@"/nonexistent/previous-image.png"]);
  failure = nil;
  [api call:@"update" args:@"{\"id\":\"tray\",\"instanceId\":\"new\",\"imagePath\":\"/nonexistent/replacement.png\",\"title\":\"Failed\"}" resolve:^(id) { assert(false); } reject:^(NSString *code, NSString *, NSError *) { failure = code; }];
  for (int n=0; n<20 && !failure; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert([failure isEqual:@"E_INVALID_DATA"]); assert([owner.options[@"title"] isEqual:@"Changed"]);
  assert(status.button.image == image); assert(status.menu == menu);
  completed = NO;
  [api call:@"update" args:@"{\"id\":\"tray\",\"instanceId\":\"new\",\"menu\":[]}" resolve:^(id) { completed = YES; } reject:^(NSString *, NSString *, NSError *) { assert(false); }];
  for (int n=0; n<20 && !completed; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert(completed); assert(status.menu == nil); assert(status.button.image == image);
  puts("Tray ownership passed");
} }
