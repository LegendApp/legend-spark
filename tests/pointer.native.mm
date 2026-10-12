#import <AppKit/AppKit.h>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
#import <objc/runtime.h>
#import "SparkPointer.h"

// Usage: pointer <scenario> <directory>. Drives @legendapp/spark/pointer's AppKit services and the shipped
// RNSparkPointerView source (inlined below over Fabric stubs) in-process. Nothing reaches the real cursor or the
// system: haptics go to a recording performer, and events are NSEvents dispatched to this app's own window.

namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkPointerViewProps : Props {
  std::string cursorType, cursorName;
  double cursorPointSize = 0;
  bool cursorHasHotSpot = false;
  double cursorHotSpotX = 0, cursorHotSpotY = 0;
  std::vector<std::string> handledEvents;
};
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
struct PointerInput { std::string type; double x, y, magnification, rotation; std::string phase, direction; double pressure; int stage; double stageTransition; std::string button; };
struct PointerViewError { std::string code, message; };
static std::vector<PointerInput> inputs;
static std::vector<PointerViewError> errors;
struct SparkPointerViewEventEmitter : EventEmitter {
  void onPointerInput(PointerInput event) const { inputs.push_back(event); }
  void onPointerViewError(PointerViewError event) const { errors.push_back(event); }
};
using ComponentDescriptorProvider = int;
struct SparkPointerViewComponentDescriptor {};
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@interface RCTViewComponentView : NSView {
@public
  Props::Shared _props;
  std::shared_ptr<const EventEmitter> _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (BOOL)isFlipped { return YES; } // As React Native's views.
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)prepareForRecycle {}
@end

// ACTUAL_POINTER_VIEW

static void Check(BOOL condition, NSString *message) {
  if (!condition) { fprintf(stderr, "FAILED: %s\n", message.UTF8String); exit(1); }
}

@interface RecordingPerformer : NSObject <NSHapticFeedbackPerformer>
@property NSMutableArray<NSArray<NSNumber *> *> *performed;
@end
@implementation RecordingPerformer
- (void)performFeedbackPattern:(NSHapticFeedbackPattern)pattern performanceTime:(NSHapticFeedbackPerformanceTime)time { [self.performed addObject:@[@(pattern), @(time)]]; }
@end

// Records what passes the pointer view: the events it does not report reach its superview.
@interface Behind : NSView
@property NSMutableArray<NSString *> *seen;
@end
@implementation Behind
- (BOOL)isFlipped { return YES; }
- (void)magnifyWithEvent:(NSEvent *)event { [self.seen addObject:@"magnify"]; }
- (void)rotateWithEvent:(NSEvent *)event { [self.seen addObject:@"rotate"]; }
- (void)otherMouseUp:(NSEvent *)event { [self.seen addObject:[NSString stringWithFormat:@"otherUp %ld", (long)event.buttonNumber]]; }
@end

// Gesture NSEvents as the window server sends them: CGEvent type 29 with the HID type and values in private fields
// (the test driver makes them the same way; docs/test-driver.md#input).
static NSEvent *Gesture(NSWindow *window, NSPoint location, int64_t hidType, int64_t phase, NSDictionary<NSNumber *, NSNumber *> *doubles, NSDictionary<NSNumber *, NSNumber *> *integers) {
  NSEvent *base = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:location modifierFlags:0 timestamp:1 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:0 pressure:0];
  CGEventRef event = CGEventCreateCopy(base.CGEvent);
  CGEventSetType(event, (CGEventType)29);
  CGEventSetIntegerValueField(event, (CGEventField)110, hidType);
  CGEventSetIntegerValueField(event, (CGEventField)132, phase);
  for (NSNumber *field in doubles) CGEventSetDoubleValueField(event, (CGEventField)field.intValue, doubles[field].doubleValue);
  for (NSNumber *field in integers) CGEventSetIntegerValueField(event, (CGEventField)field.intValue, integers[field].longLongValue);
  NSEvent *result = [NSEvent eventWithCGEvent:event];
  CFRelease(event);
  return result;
}
static NSEvent *Button(NSWindow *window, NSPoint location, BOOL down, int64_t button) {
  NSEvent *base = [NSEvent mouseEventWithType:down ? NSEventTypeOtherMouseDown : NSEventTypeOtherMouseUp location:location modifierFlags:0 timestamp:1 windowNumber:window.windowNumber context:nil eventNumber:1 clickCount:1 pressure:down];
  CGEventRef event = CGEventCreateCopy(base.CGEvent);
  CGEventSetIntegerValueField(event, kCGMouseEventButtonNumber, button);
  NSEvent *result = [NSEvent eventWithCGEvent:event];
  CFRelease(event);
  return result;
}
static NSWindow *MakeWindow(void) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  // Gesture events reach only a window on screen: transparent, ignoring the real mouse, behind everything, never key.
  window.alphaValue = 0; window.ignoresMouseEvents = YES;
  [window orderBack:nil];
  return window;
}
static NSString *Describe(NSDictionary *event) {
  NSMutableArray *parts = [NSMutableArray new];
  for (NSString *key in [event.allKeys sortedArrayUsingSelector:@selector(compare:)]) [parts addObject:[NSString stringWithFormat:@"%@=%@", key, event[key]]];
  return [parts componentsJoinedByString:@" "];
}

static void Haptics(void) {
  RecordingPerformer *performer = [RecordingPerformer new];
  performer.performed = [NSMutableArray new];
  Check(SparkPointerPerformHaptic(performer, @"generic", @"default") && SparkPointerPerformHaptic(performer, @"alignment", @"now") && SparkPointerPerformHaptic(performer, @"levelChange", @"drawCompleted"), @"known patterns and times perform");
  Check([performer.performed isEqual:(@[@[@(NSHapticFeedbackPatternGeneric), @(NSHapticFeedbackPerformanceTimeDefault)], @[@(NSHapticFeedbackPatternAlignment), @(NSHapticFeedbackPerformanceTimeNow)],
    @[@(NSHapticFeedbackPatternLevelChange), @(NSHapticFeedbackPerformanceTimeDrawCompleted)]])], [NSString stringWithFormat:@"each maps to AppKit's pattern and time (%@)", performer.performed]);
  Check(!SparkPointerPerformHaptic(performer, @"buzz", @"now") && !SparkPointerPerformHaptic(performer, @"generic", @"later") && performer.performed.count == 3, @"unknown values perform nothing");
  // The app's performer exists on every Mac; only a Force Touch trackpad plays it.
  Check([NSHapticFeedbackManager.defaultPerformer conformsToProtocol:@protocol(NSHapticFeedbackPerformer)], @"AppKit provides a default performer");
}

static void Cursors(NSString *directory) {
  NSString *error = nil;
  NSCursor *symbol = SparkPointerCursor(@"symbol", @"pencil.tip", 24, NO, NSZeroPoint, &error);
  Check(symbol && !error && [symbol.image.accessibilityDescription isEqual:@"pencil.tip"], [NSString stringWithFormat:@"an SF Symbol cursor named for the driver (%@)", error]);
  Check(NSEqualPoints(symbol.hotSpot, NSMakePoint(symbol.image.size.width / 2, symbol.image.size.height / 2)) && symbol.image.size.height > 16, @"a symbol's hot spot defaults to its center, at the point size");
  NSCursor *spotted = SparkPointerCursor(@"symbol", @"pencil.tip", 24, YES, NSMakePoint(1, 2), &error);
  Check(NSEqualPoints(spotted.hotSpot, NSMakePoint(1, 2)), @"a given hot spot");
  NSString *path = [directory stringByAppendingPathComponent:@"cursor.png"];
  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:20 pixelsHigh:10 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
    colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
  NSCursor *image = SparkPointerCursor(@"image", path, 0, YES, NSMakePoint(3, 4), &error);
  Check(image && NSEqualSizes(image.image.size, NSMakeSize(20, 10)) && NSEqualPoints(image.hotSpot, NSMakePoint(3, 4)) && [image.image.accessibilityDescription isEqual:@"cursor.png"],
    [NSString stringWithFormat:@"an image file cursor at its size with its hot spot (%@)", error]);
  error = nil;
  Check(!SparkPointerCursor(@"image", [directory stringByAppendingPathComponent:@"missing.png"], 0, YES, NSZeroPoint, &error) && [error hasPrefix:@"No image could be read"], @"a missing image fails");
  error = nil;
  Check(!SparkPointerCursor(@"symbol", @"no.such.symbol.spark", 16, NO, NSZeroPoint, &error) && [error hasPrefix:@"No SF Symbol"], @"an unknown symbol fails");
  error = nil;
  Check(!SparkPointerCursor(@"image", path, 0, YES, NSMakePoint(21, 0), &error) && [error containsString:@"outside"], @"a hot spot outside the image fails");
}

static void Events(void) {
  NSWindow *window = MakeWindow();
  NSView *flipped = [[RCTViewComponentView alloc] initWithFrame:NSMakeRect(100, 50, 200, 100)];
  NSView *unflipped = [[NSView alloc] initWithFrame:NSMakeRect(100, 50, 200, 100)];
  [window.contentView addSubview:flipped];
  [window.contentView addSubview:unflipped];
  NSPoint at = NSMakePoint(130, 140); // Window coordinates (y-up): 30 from the views' left, 10 below their top.
  auto map = ^NSDictionary *(NSEvent *event, NSView *view) { return SparkPointerEvent(event, view); };
  NSDictionary *magnify = map(Gesture(window, at, 8, 2, @{ @113: @0.25 }, @{}), flipped);
  Check([magnify isEqual:(@{ @"type": @"magnify", @"magnification": @0.25, @"phase": @"changed", @"x": @30, @"y": @10 })], [NSString stringWithFormat:@"magnify (%@)", Describe(magnify)]);
  Check([map(Gesture(window, at, 8, 2, @{ @113: @0.25 }, @{}), unflipped)[@"y"] isEqual:@10], @"points are from the top-left in an unflipped view too");
  NSDictionary *rotate = map(Gesture(window, at, 5, 1, @{ @114: @15 }, @{}), flipped);
  Check([rotate[@"rotation"] isEqual:@-15] && [rotate[@"phase"] isEqual:@"began"], [NSString stringWithFormat:@"rotate is clockwise: AppKit's counterclockwise 15 is -15 (%@)", Describe(rotate)]);
  Check([map(Gesture(window, at, 5, 4, @{ @114: @0 }, @{}), flipped)[@"phase"] isEqual:@"ended"], @"gesture phases");
  for (NSArray *swipe in @[@[@4, @"left"], @[@8, @"right"], @[@1, @"up"], @[@2, @"down"]]) {
    NSDictionary *event = map(Gesture(window, at, 16, 0, @{}, @{ @115: swipe[0] }), flipped);
    Check([event[@"type"] isEqual:@"swipe"] && [event[@"direction"] isEqual:swipe[1]], [NSString stringWithFormat:@"swipe %@ (%@)", swipe[1], Describe(event)]);
  }
  Check([map(Gesture(window, at, 22, 0, @{}, @{}), flipped) isEqual:(@{ @"type": @"smartMagnify", @"x": @30, @"y": @10 })], @"smart magnify");
  NSDictionary *pressure = map(Gesture(window, at, 32, 2, @{ @148: @0.5, @147: @0.25 }, @{ @143: @2 }), flipped);
  Check([pressure[@"pressure"] isEqual:@0.5] && [pressure[@"stage"] isEqual:@2] && [pressure[@"stageTransition"] isEqual:@0.25], [NSString stringWithFormat:@"pressure (%@)", Describe(pressure)]);
  Check([map(Button(window, at, NO, 3), flipped)[@"button"] isEqual:@"back"] && [map(Button(window, at, NO, 4), flipped)[@"button"] isEqual:@"forward"], @"back and forward report on release");
  Check(!map(Button(window, at, YES, 3), flipped) && !map(Button(window, at, NO, 2), flipped), @"presses and other buttons are not reported");
  Check(!map([NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:at modifierFlags:0 timestamp:1 windowNumber:window.windowNumber context:nil eventNumber:1 clickCount:1 pressure:1], flipped), @"other events are not reported");
  [window orderOut:nil];
}

static IMP addCursorRect;
static NSMutableArray<NSCursor *> *cursorRects;
static void RecordCursorRect(NSView *self, SEL selector, NSRect rect, NSCursor *cursor) { [cursorRects addObject:cursor]; }
static std::shared_ptr<SparkPointerViewProps> PropsWith(std::vector<std::string> handled, std::string cursorType = "", std::string cursorName = "") {
  auto props = std::make_shared<SparkPointerViewProps>();
  props->handledEvents = handled; props->cursorType = cursorType; props->cursorName = cursorName; props->cursorPointSize = 16;
  return props;
}
static void View(void) {
  NSWindow *window = MakeWindow();
  Behind *behind = [[Behind alloc] initWithFrame:window.contentView.bounds];
  behind.seen = [NSMutableArray new];
  window.contentView = behind;
  RNSparkPointerView *view = [[RNSparkPointerView alloc] init];
  view.frame = NSMakeRect(0, 0, 200, 150);
  [behind addSubview:view];
  NSView *child = [[RCTViewComponentView alloc] initWithFrame:NSMakeRect(10, 10, 50, 50)];
  [view addSubview:child];
  view->_eventEmitter = std::make_shared<SparkPointerViewEventEmitter>();
  [view updateProps:PropsWith({ "magnify", "mouseButton" }, "symbol", "hand.point.up") oldProps:nullptr];
  [window orderBack:nil];
  NSPoint overChild = [child convertPoint:NSMakePoint(20, 20) toView:nil];
  // NSWindow drops a gesture change that no began event started.
  [window sendEvent:Gesture(window, overChild, 8, 1, @{ @113: @0.5 }, @{})];
  Check(inputs.size() == 1 && inputs[0].type == "magnify" && inputs[0].magnification == 0.5 && inputs[0].phase == "began" && inputs[0].x == 30 && inputs[0].y == 30 && behind.seen.count == 0,
    [NSString stringWithFormat:@"a handled gesture over a descendant reaches the pointer view through the responder chain, at the view's coordinates, and stops there (%zu inputs%@, behind saw %@)",
      inputs.size(), inputs.empty() ? @"" : [NSString stringWithFormat:@": %s %g at %g,%g", inputs[0].type.c_str(), inputs[0].magnification, inputs[0].x, inputs[0].y], behind.seen]);
  [window sendEvent:Gesture(window, overChild, 5, 1, @{ @114: @10 }, @{})];
  Check(inputs.size() == 1 && [behind.seen isEqual:@[@"rotate"]], @"an event without a handler passes on to the view behind");
  [window sendEvent:Button(window, overChild, YES, 4)];
  [window sendEvent:Button(window, overChild, NO, 4)];
  Check(inputs.size() == 2 && inputs[1].type == "mouseButton" && inputs[1].button == "forward", @"forward is reported on release");
  [window sendEvent:Button(window, overChild, YES, 2)];
  [window sendEvent:Button(window, overChild, NO, 2)];
  Check(inputs.size() == 2 && [behind.seen.lastObject isEqual:@"otherUp 2"], @"the middle button passes on");
  // The custom cursor covers the view.
  cursorRects = [NSMutableArray new];
  addCursorRect = method_setImplementation(class_getInstanceMethod(NSView.class, @selector(addCursorRect:cursor:)), (IMP)RecordCursorRect);
  [view resetCursorRects];
  Check(cursorRects.count == 1 && [cursorRects[0].image.accessibilityDescription isEqual:@"hand.point.up"], @"the custom cursor's rect");
  // A cursor that cannot load is reported, and the view keeps no custom cursor.
  auto previous = view->_props;
  [view updateProps:PropsWith({ "magnify" }, "symbol", "no.such.symbol.spark") oldProps:previous];
  Check(errors.size() == 1 && errors[0].code == "E_INVALID_ARGUMENT" && errors[0].message.find("No SF Symbol") == 0, @"a cursor that cannot load is reported");
  [cursorRects removeAllObjects];
  [view resetCursorRects];
  Check(cursorRects.count == 0, @"and leaves no cursor rect");
  // Unrelated prop updates do not rebuild or report the cursor again.
  [view updateProps:PropsWith({ "magnify", "rotate" }, "symbol", "no.such.symbol.spark") oldProps:view->_props];
  Check(errors.size() == 1, @"an unchanged cursor is not loaded again");
  [window sendEvent:Gesture(window, overChild, 5, 1, @{ @114: @10 }, @{})];
  Check(inputs.size() == 3 && inputs[2].type == "rotate" && inputs[2].rotation == -10, @"handled events follow the props");
  [view prepareForRecycle];
  [window sendEvent:Gesture(window, overChild, 8, 1, @{ @113: @0.5 }, @{})];
  Check(inputs.size() == 3 && [behind.seen.lastObject isEqual:@"magnify"], @"a recycled view handles nothing");
  method_setImplementation(class_getInstanceMethod(NSView.class, @selector(addCursorRect:cursor:)), addCursorRect);
  [window orderOut:nil];
}

int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSString *scenario = argc > 1 ? @(argv[1]) : @"";
  if ([scenario isEqual:@"haptics"]) Haptics();
  else if ([scenario isEqual:@"cursors"]) Cursors(@(argv[2]));
  else if ([scenario isEqual:@"events"]) Events();
  else if ([scenario isEqual:@"view"]) View();
  else Check(NO, [@"unknown scenario " stringByAppendingString:scenario]);
  Check(!NSApp.isActive, @"the app never activates");
  printf("PASS %s\n", scenario.UTF8String);
  return 0;
} }
