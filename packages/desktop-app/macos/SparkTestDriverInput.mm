#import "SparkTestDriverPrivate.h"
#if SPARK_TEST_DRIVER_PRIVATE_EVENTS
#include <dlfcn.h>
#endif

// In-process input for the test driver (docs/test-driver.md#input). The driver creates NSEvents and dispatches
// them through -[NSApplication sendEvent:] to this app's own windows. Nothing is posted to the system event
// stream: the real pointer and keyboard are untouched, other apps never see the events, and no TCC permission
// is involved. What AppKit does with such events, measured in tests/test-driver.native.mm, shapes this file:
//
// - NSWindow ignores mouse events for a window that is not on screen. For the duration of a pointer command the
//   driver orders a window that is not on screen in: fully transparent, ignoring real mouse events, behind every
//   other window, never activated. It orders it out again afterwards, because a window on screen that is not the
//   key window ignores key equivalents (a default button's Return), while one that is not on screen does not.
//   The window is ordered in before the command's events are made: AppKit locates an event made from a CGEvent
//   (moves, gestures, extra buttons) by the window's position in the window server, which for a window that has not
//   been on screen can still be the top-left of the display (measured on macOS 26 CI runners, #375).
// - A driven app never activates, so it has no key window, and -[NSApplication sendEvent:] gives key events only to
//   local monitors and menu key equivalents. The driver routes its key events the way AppKit routes them to a key
//   window instead: the window's key equivalents, the main menu's (Command and Control keys only), then
//   -[NSWindow sendEvent:] (the first responder). Local event monitors therefore do not see them. They cannot be given a deterministic place either:
//   AppKit runs them in hash-table order.
// - Clicking a window of an inactive app is a "first mouse" click: views that refuse acceptsFirstMouse: ignore it.
//   AppKit controls accept it; React Native views refuse it unless their acceptsFirstMouse prop is set. In the key
//   window of an active app no click is a first-mouse click, so for the duration of a press the driver sets
//   acceptsFirstMouse on the React Native views (RCTUIView) under the pointer and restores it afterwards.
// - AppKit controls take keyboard focus and arrow keys only in the key window: a click does not make a slider or
//   button the first responder, and NSSlider ignores arrow keyDowns even as first responder. Arrow keys reach text
//   and custom views; stepping a control with the keyboard needs the black-box backend.
// - React Native matches a mouse-up or drag to its mouse-down by event number, as the window server numbers them.
// - Control tracking loops (buttons, sliders, text selection) take the rest of a gesture from the event queue, so a
//   command posts all of its events to the queue and then dispatches whatever no tracking loop consumed.
// - A command can leave the app in a nested run loop (a modal session). The session runs requests as run-loop
//   blocks (SparkTestDriver.mm), and a command replies as soon as the app enters a nested run loop after taking
//   the command's last event, so later requests run inside that loop.
// - A native menu would track the real pointer and keyboard on screen, so a command that opens one closes it and
//   fails with E_MENU: menus need the black-box backend.
// - NSEvent has no factory for trackpad gestures. The window server sends them as gesture events (CGEvent type 29)
//   whose HID type names the gesture, and +[NSEvent eventWithCGEvent:] turns such an event into a magnify, rotate,
//   swipe, smart magnify or pressure NSEvent. The fields are private; they are listed below as measured. A driven app
//   has no key window, and -[NSApplication sendEvent:] drops magnify, rotate, swipe and smart magnify events then, so
//   the driver sends those to the window (-[NSWindow sendEvent:]), which gives them to the view under the pointer.
//   Pressure events need a gesture phase and arrive between the press and release of a click.

static NSString *const SparkInputMode = @"SparkTestDriverInput"; // No sources: dequeueing in it runs nothing else.
static const NSEventMask SparkPointerMask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged |
  NSEventMaskRightMouseDown | NSEventMaskRightMouseUp | NSEventMaskRightMouseDragged | NSEventMaskMouseMoved |
  NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp | NSEventMaskMouseEntered | NSEventMaskMouseExited | NSEventMaskScrollWheel | NSEventMaskPressure;
// Events the driver gives to the window directly (see SparkDeliver).
static const NSEventMask SparkKeyMask = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged;
static const NSEventMask SparkGestureMask = NSEventMaskMagnify | NSEventMaskRotate | NSEventMaskSwipe | NSEventMaskSmartMagnify;
static NSTimeInterval lastTime = 0;
static NSInteger clickNumber = 0; // Like the window server, a press and its drags and release share one event number.
static NSPoint pointer = { NAN, NAN }; // The driver's pointer, in screen coordinates. The real pointer never moves.
static __weak NSWindow *focus; // The window of the last pointer input: what a click makes the key window.
static NSMapTable<NSTrackingArea *, NSWindow *> *hovered; // Tracking areas the driver's pointer is inside.

NSArray<NSString *> *SparkDriverInputCommandNames(void) {
  static NSArray *names = @[@"tap", @"hover", @"drag", @"scroll", @"gesture", @"cursor", @"pressKey", @"typeText"];
  return names;
}

// Event times are unique, so the driver recognizes its last event after a round trip through the queue (which
// copies events), and 8 ms apart, a plausible input rate for velocity and double-click logic.
static NSTimeInterval SparkEventTime(void) { return lastTime = MAX(lastTime + 0.008, NSProcessInfo.processInfo.systemUptime); }

void SparkDriverInputStart(void) {
  hovered = [NSMapTable weakToWeakObjectsMapTable];
  SparkDriverCursorStart();
}
// A key window performs its default button on Return or Enter (NSWindow.defaultButtonCell). The button's own key
// equivalent check refuses in a window that is not key once that window has been on screen, as pointer input
// puts it, so the driver performs it for the window it treats as key.
static BOOL SparkDefaultButton(NSEvent *event, NSWindow *window) {
  NSButtonCell *cell = window.defaultButtonCell;
  BOOL returnKey = [event.charactersIgnoringModifiers isEqualToString:@"\r"] || [event.charactersIgnoringModifiers isEqualToString:@"\x03"];
  NSEventModifierFlags held = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift);
  if (!returnKey || held || !cell.isEnabled || [cell.controlView isHiddenOrHasHiddenAncestor]) return NO;
  [cell performClick:nil];
  return YES;
}
// AppKit's routing of a key event to the key window (see the top of this file): the window's key equivalents,
// the main menu's for Command and Control keys, then the first responder. NSMenu ignores the Function flag when
// matching, so the system's Globe-key items (Fn-D Start Dictation, Fn-E Emoji & Symbols, Fn-F Full Screen) would
// take plain typed letters.
static void SparkRouteKey(NSEvent *event, NSWindow *window) {
  BOOL menuKey = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl);
  if (event.type == NSEventTypeKeyDown && ([window performKeyEquivalent:event] || SparkDefaultButton(event, window) || (menuKey && [NSApp.mainMenu performKeyEquivalent:event]))) return;
  [window sendEvent:event];
}

#pragma mark Events

static NSEvent *SparkMouse(NSEventType type, NSWindow *window, NSPoint location, NSEventModifierFlags flags, NSInteger clicks) {
  BOOL down = type == NSEventTypeLeftMouseDown || type == NSEventTypeRightMouseDown || type == NSEventTypeOtherMouseDown;
  BOOL pressed = down || type == NSEventTypeLeftMouseDragged || type == NSEventTypeRightMouseDragged;
  NSEvent *event = [NSEvent mouseEventWithType:type location:location modifierFlags:flags timestamp:SparkEventTime() windowNumber:window.windowNumber
    context:nil eventNumber:down ? ++clickNumber : clickNumber clickCount:clicks pressure:pressed ? 1 : 0];
  NSPoint screen = [window convertPointToScreen:location];
  if (isnan(pointer.x)) pointer = screen;
  if (type != NSEventTypeMouseMoved && type != NSEventTypeLeftMouseDragged) { pointer = screen; return event; }
  // Moves carry the pointer's travel (deltaX, deltaY: y-down), which the window server adds to real events.
  CGEventRef copy = CGEventCreateCopy(event.CGEvent);
  CGEventSetIntegerValueField(copy, kCGMouseEventDeltaX, llround(screen.x - pointer.x));
  CGEventSetIntegerValueField(copy, kCGMouseEventDeltaY, llround(pointer.y - screen.y));
  pointer = screen;
  event = [NSEvent eventWithCGEvent:copy];
  CFRelease(copy);
  return event;
}
// NSEvent has no scroll wheel factory, so this retypes a copy of an AppKit-made mouse event, which already
// addresses the window and location. Driver deltas are positive toward the end of the content (down, right);
// wheel deltas are positive toward its start.
static NSEvent *SparkScroll(NSWindow *window, NSPoint location, NSEventModifierFlags flags, double dx, double dy, BOOL precise) {
  CGEventRef event = CGEventCreateCopy(SparkMouse(NSEventTypeMouseMoved, window, location, flags, 0).CGEvent);
  CGEventSetType(event, kCGEventScrollWheel);
  CGEventSetIntegerValueField(event, kCGScrollWheelEventIsContinuous, precise);
  CGEventSetIntegerValueField(event, precise ? kCGScrollWheelEventPointDeltaAxis1 : kCGScrollWheelEventDeltaAxis1, llround(-dy));
  CGEventSetIntegerValueField(event, precise ? kCGScrollWheelEventPointDeltaAxis2 : kCGScrollWheelEventDeltaAxis2, llround(-dx));
  CGEventSetDoubleValueField(event, kCGScrollWheelEventFixedPtDeltaAxis1, -dy);
  CGEventSetDoubleValueField(event, kCGScrollWheelEventFixedPtDeltaAxis2, -dx);
  NSEvent *result = [NSEvent eventWithCGEvent:event];
  CFRelease(event);
  return result;
}
// A press or release of mouse button `button` (0 left, 1 right, 2 middle, 3 back, 4 forward). AppKit's factory
// numbers every other-mouse event button 2, so other buttons are a copy with the button number set, located as
// gestures are (macOS 26 moves a copy's location). nil when AppKit's location stays off.
static NSEvent *SparkButton(BOOL down, NSInteger button, NSWindow *window, NSPoint location, NSEventModifierFlags flags, NSInteger clicks) {
  NSEventType type = button == 0 ? (down ? NSEventTypeLeftMouseDown : NSEventTypeLeftMouseUp) : button == 1 ? (down ? NSEventTypeRightMouseDown : NSEventTypeRightMouseUp)
    : (down ? NSEventTypeOtherMouseDown : NSEventTypeOtherMouseUp);
  NSEvent *event = SparkMouse(type, window, location, flags, clicks);
  if (button < 2) return event;
  CGEventRef copy = CGEventCreateCopy(event.CGEvent);
  CGEventSetIntegerValueField(copy, kCGMouseEventButtonNumber, button);
  NSEvent *located = SparkDriverLocated(copy, event);
  CFRelease(copy);
  return located.buttonNumber == button && located.type == event.type ? located : nil;
}
// Gesture events: CGEvent type 29 with these private fields, as +[NSEvent eventWithCGEvent:] reads them. The HID type
// selects the NSEvent: 8 magnify, 5 rotate, 16 swipe, 22 smart magnify, 32 pressure.
enum : uint32_t { SparkGestureHIDType = 110, SparkGestureMagnification = 113, SparkGestureRotation = 114, SparkGestureSwipe = 115,
  SparkGesturePhase = 132, SparkGestureStage = 143, SparkGestureStageTransition = 147, SparkGesturePressure = 148 };
// The event `prototype` (a changed copy of `mouse`, an AppKit mouse event at a point in its window) makes at that point.
// AppKit takes a gesture's (and a copied event's) locationInWindow from the event's window-local location (top-left origin), which CoreGraphics
// keeps in a private field and clears when the global location is set, and macOS versions map them differently (macOS 26
// lands a constant offset away). So the event gets both locations of `mouse`, and when AppKit's location is off, the
// offset is taken out of the window-local location, else out of the global one. nil when AppKit's location is still off,
// or this macOS lacks the private functions.
// The private functions compile only with SPARK_TEST_DRIVER_PRIVATE_EVENTS (an app's macos.testDriverPrivateEvents), so
// other apps' binaries never name them: App Store review flags private API names (docs/test-driver.md#private-event-functions).
NSString *SparkDriverPrivateEventsMissing(void) {
#if SPARK_TEST_DRIVER_PRIVATE_EVENTS
  return nil;
#else
  return [NSString stringWithFormat:@"The app was built without SPARK_TEST_DRIVER_PRIVATE_EVENTS (macos.testDriverPrivateEvents), so it has no gesture or extra mouse button synthesis (macOS %@)",
    NSProcessInfo.processInfo.operatingSystemVersionString];
#endif
}
NSEvent *SparkDriverLocated(CGEventRef prototype, NSEvent *mouse) {
#if !SPARK_TEST_DRIVER_PRIVATE_EVENTS
  return nil;
#else
  static auto get = (CGPoint (*)(CGEventRef))dlsym(RTLD_DEFAULT, "CGEventGetWindowLocation");
  static auto set = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  if (!get || !set) return nil;
  NSPoint wanted = mouse.locationInWindow;
  auto make = ^NSEvent *(CGPoint global, CGPoint inWindow) {
    CGEventRef event = CGEventCreateCopy(prototype);
    CGEventSetLocation(event, global);
    set(event, inWindow);
    NSEvent *result = [NSEvent eventWithCGEvent:event];
    CFRelease(event);
    return result;
  };
  auto off = ^BOOL(NSEvent *event) { return !event || hypot(event.locationInWindow.x - wanted.x, event.locationInWindow.y - wanted.y) > 0.5; };
  CGPoint global = CGEventGetLocation(mouse.CGEvent), inWindow = get(mouse.CGEvent);
  NSEvent *event = make(global, inWindow);
  if (!off(event)) return event;
  // Both locations are y-down; locationInWindow is y-up.
  CGFloat dx = event.locationInWindow.x - wanted.x, dy = event.locationInWindow.y - wanted.y;
  NSEvent *corrected = make(global, CGPointMake(inWindow.x - dx, inWindow.y + dy));
  if (!off(corrected)) return corrected;
  corrected = make(CGPointMake(global.x - dx, global.y + dy), inWindow);
  return off(corrected) ? nil : corrected;
#endif
}
// A gesture NSEvent at `location` (window coordinates), checked against what was asked for: the fields are private and
// AppKit's reading of them changes between macOS versions, so a mismatch is a failure, never an event for some other
// view. nil, with `failure` set, on a mismatch.
static NSEvent *SparkGesture(NSWindow *window, NSPoint location, NSEventModifierFlags flags, int64_t hidType, NSEventPhase phase, NSDictionary<NSNumber *, NSNumber *> *values, NSString **failure) {
  NSEvent *mouse = SparkMouse(NSEventTypeMouseMoved, window, location, flags, 0);
  CGEventRef event = CGEventCreateCopy(mouse.CGEvent);
  CGEventSetType(event, (CGEventType)29);
  CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointer, window.windowNumber);
  CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent, window.windowNumber);
  CGEventSetIntegerValueField(event, (CGEventField)SparkGestureHIDType, hidType);
  // The window server's phases are 1 began, 2 changed and 4 ended; AppKit maps them to NSEventPhase.
  CGEventSetIntegerValueField(event, (CGEventField)SparkGesturePhase, phase == NSEventPhaseBegan ? 1 : phase == NSEventPhaseChanged ? 2 : phase == NSEventPhaseEnded ? 4 : 0);
  [values enumerateKeysAndObjectsUsingBlock:^(NSNumber *field, NSNumber *value, BOOL *) {
    if (field.unsignedIntValue == SparkGestureSwipe || field.unsignedIntValue == SparkGestureStage) CGEventSetIntegerValueField(event, (CGEventField)field.unsignedIntValue, value.longLongValue);
    else CGEventSetDoubleValueField(event, (CGEventField)field.unsignedIntValue, value.doubleValue);
  }];
  // Without a located event (the check below reports why), the event AppKit makes from the copy as it is.
  NSEvent *result = SparkDriverLocated(event, mouse) ?: [NSEvent eventWithCGEvent:event];
  CFRelease(event);
  NSString *problem = SparkDriverCheckGesture(result, window, location, hidType, phase, values);
  if (!problem) return result;
  *failure = [NSString stringWithFormat:@"Gesture synthesis is unsupported on macOS %@: %@", NSProcessInfo.processInfo.operatingSystemVersionString, problem];
  return nil;
}
// Why `event` is not the gesture asked for, or nil when it is.
NSString *SparkDriverCheckGesture(NSEvent *event, NSWindow *window, NSPoint location, int64_t hidType, NSEventPhase phase, NSDictionary<NSNumber *, NSNumber *> *values) {
  NSDictionary<NSNumber *, NSNumber *> *types = @{ @8: @(NSEventTypeMagnify), @5: @(NSEventTypeRotate), @16: @(NSEventTypeSwipe), @22: @(NSEventTypeSmartMagnify), @32: @(NSEventTypePressure) };
  if (!event) return @"AppKit made no event";
  if (event.type != (NSEventType)types[@(hidType)].unsignedIntegerValue) return [NSString stringWithFormat:@"event type %lu, not %@", (unsigned long)event.type, types[@(hidType)]];
  if (event.windowNumber != window.windowNumber) return [NSString stringWithFormat:@"window %ld, not %ld", (long)event.windowNumber, (long)window.windowNumber];
  if (hypot(event.locationInWindow.x - location.x, event.locationInWindow.y - location.y) > 0.5)
    return [NSString stringWithFormat:@"location %@, not %@", NSStringFromPoint(event.locationInWindow), NSStringFromPoint(location)];
  if (phase != NSEventPhaseNone && event.phase != phase) return [NSString stringWithFormat:@"phase %lu, not %lu", (unsigned long)event.phase, (unsigned long)phase];
  auto near = ^BOOL(double actual, NSNumber *expected) { return !expected || fabs(actual - expected.doubleValue) < 1e-4; };
  NSInteger swipe = [values[@(SparkGestureSwipe)] integerValue];
  BOOL valuesMatch = hidType == 8 ? near(event.magnification, values[@(SparkGestureMagnification)])
    : hidType == 5 ? near(event.rotation, values[@(SparkGestureRotation)])
    : hidType == 16 ? event.deltaX == (swipe == 4 ? 1 : swipe == 8 ? -1 : 0) && event.deltaY == (swipe == 1 ? 1 : swipe == 2 ? -1 : 0)
    : hidType == 32 ? event.stage == [values[@(SparkGestureStage)] integerValue] && near(event.pressure, values[@(SparkGesturePressure)]) && near(event.stageTransition, values[@(SparkGestureStageTransition)])
    : YES;
  return valuesMatch ? nil : @"its values differ from the fields set";
}
static NSEvent *SparkKey(NSEventType type, NSWindow *window, NSString *characters, NSString *ignoring, unsigned short code, NSEventModifierFlags flags) {
  return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:SparkEventTime() windowNumber:window.windowNumber
    context:nil characters:characters charactersIgnoringModifiers:ignoring isARepeat:NO keyCode:code];
}

#pragma mark Keys

// US ANSI virtual key codes (HIToolbox kVK_ANSI_*): the character at index n, unshifted and shifted, is key code n.
static NSString *const SparkKeys = @"asdfhgzxcv\u00a7bqweryt123465=97-80]ou[ip\rlj'k;\\,/nm.\t `";
static NSString *const SparkShiftedKeys = @"ASDFHGZXCV\u00b1BQWERYT!@#$^%+(&_*)}OU{IP\rLJ\"K:|<?NM>\t ~";
// Keys without a character of their own, as AppKit's function-key characters, with their key codes and the
// modifier flags hardware sets for them.
static NSDictionary<NSString *, NSArray<NSNumber *> *> *SparkFunctionKeys(void) {
  static NSDictionary *keys = ^{
    NSUInteger arrows = NSEventModifierFlagNumericPad | NSEventModifierFlagFunction, function = NSEventModifierFlagFunction;
    NSMutableDictionary *table = [@{
      @"\u001b": @[@53, @0], @"\u007f": @[@51, @0], @"\uf728": @[@117, @(function)], @"\uf729": @[@115, @(function)], @"\uf72b": @[@119, @(function)],
      @"\uf72c": @[@116, @(function)], @"\uf72d": @[@121, @(function)], @"\uf700": @[@126, @(arrows)], @"\uf701": @[@125, @(arrows)],
      @"\uf702": @[@123, @(arrows)], @"\uf703": @[@124, @(arrows)],
    } mutableCopy];
    const unsigned short codes[] = { 122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90 };
    for (unichar n = 0; n < 20; n++) table[[NSString stringWithCharacters:(unichar[]){ (unichar)(0xf704 + n) } length:1]] = @[@(codes[n]), @(function)];
    return [table copy];
  }();
  return keys;
}
static const struct { const char *name; NSEventModifierFlags flag; unsigned short code; } SparkModifiers[] = {
  { "ctrl", NSEventModifierFlagControl, 59 }, { "option", NSEventModifierFlagOption, 58 }, { "shift", NSEventModifierFlagShift, 56 },
  { "cmd", NSEventModifierFlagCommand, 55 }, { "fn", NSEventModifierFlagFunction, 63 },
};
static BOOL SparkParseModifiers(id value, NSEventModifierFlags *flags) {
  *flags = 0;
  if (!value) return YES;
  if (![value isKindOfClass:NSArray.class]) return NO;
  NSDictionary *aliases = @{ @"command": @"cmd", @"control": @"ctrl", @"alt": @"option" };
  for (id name in value) {
    if (![name isKindOfClass:NSString.class]) return NO;
    NSString *canonical = aliases[name] ?: name;
    BOOL known = NO;
    for (auto modifier : SparkModifiers) if ([canonical isEqualToString:@(modifier.name)]) { *flags |= modifier.flag; known = YES; }
    if (!known) return NO;
  }
  return YES;
}
// One key press: flagsChanged for each held modifier, keyDown and keyUp, then the modifiers released in reverse.
// `key` is one character: a character key, or AppKit's character for a function key (NSUpArrowFunctionKey, …).
static NSArray<NSEvent *> *SparkPress(NSWindow *window, NSString *key, NSEventModifierFlags modifiers) {
  NSArray<NSNumber *> *function = SparkFunctionKeys()[key];
  BOOL single = !function && key.length == 1;
  NSUInteger index = single ? [SparkKeys rangeOfString:key options:NSLiteralSearch].location : NSNotFound;
  NSUInteger shifted = single && index == NSNotFound ? [SparkShiftedKeys rangeOfString:key options:NSLiteralSearch].location : NSNotFound;
  if (shifted != NSNotFound) { index = shifted; modifiers |= NSEventModifierFlagShift; }
  // A character with no key on the US layout (é, 😀) is delivered with no key code, as text from an input method.
  unsigned short code = function ? function[0].unsignedShortValue : index != NSNotFound ? (unsigned short)index : 0xffff;
  NSString *ignoring = index != NSNotFound && (modifiers & NSEventModifierFlagShift) ? [SparkShiftedKeys substringWithRange:NSMakeRange(index, 1)] : key;
  NSString *characters = ignoring;
  unichar first = [key characterAtIndex:0];
  if ((modifiers & NSEventModifierFlagControl) && key.length == 1 && first >= 'a' && first <= 'z') characters = [NSString stringWithCharacters:(unichar[]){ (unichar)(first - 'a' + 1) } length:1];
  NSMutableArray<NSEvent *> *events = [NSMutableArray new];
  NSEventModifierFlags held = 0;
  for (auto modifier : SparkModifiers) if (modifiers & modifier.flag) {
    held |= modifier.flag;
    [events addObject:SparkKey(NSEventTypeFlagsChanged, window, @"", @"", modifier.code, held)];
  }
  NSEventModifierFlags flags = modifiers | (function ? function[1].unsignedIntegerValue : 0);
  [events addObject:SparkKey(NSEventTypeKeyDown, window, characters, ignoring, code, flags)];
  [events addObject:SparkKey(NSEventTypeKeyUp, window, characters, ignoring, code, flags)];
  for (NSInteger n = (NSInteger)(sizeof SparkModifiers / sizeof SparkModifiers[0]) - 1; n >= 0; n--) if (modifiers & SparkModifiers[n].flag) {
    held &= ~SparkModifiers[n].flag;
    [events addObject:SparkKey(NSEventTypeFlagsChanged, window, @"", @"", SparkModifiers[n].code, held)];
  }
  return events;
}

#pragma mark Pointer

// Prepares a window for one pointer command (see the top of this file) and returns the block that restores it: a
// window that is not on screen is put on screen, and when the command presses at `press`, the React Native views
// there accept the first mouse.
static dispatch_block_t SparkPresent(NSWindow *window, const NSPoint *press) {
  focus = window;
  NSMutableArray<NSView *> *accepting = [NSMutableArray new];
  for (NSView *view = press ? [SparkDriverFrameView(window) hitTest:*press] : nil; view; view = view.superview)
    if ([view respondsToSelector:@selector(setAcceptsFirstMouse:)] && ![[view valueForKey:@"acceptsFirstMouse"] boolValue]) {
      [view setValue:@YES forKey:@"acceptsFirstMouse"];
      [accepting addObject:view];
    }
  BOOL shown = !window.isVisible;
  CGFloat alpha = window.alphaValue;
  BOOL ignores = window.ignoresMouseEvents;
  if (shown) {
    window.alphaValue = 0;
    window.ignoresMouseEvents = YES;
    [window orderBack:nil];
  }
  return ^{
    for (NSView *view in accepting) [view setValue:@NO forKey:@"acceptsFirstMouse"];
    if (!shown) return;
    [window orderOut:nil];
    window.alphaValue = alpha;
    window.ignoresMouseEvents = ignores;
  };
}
static void SparkAreasAt(NSView *view, NSPoint location, NSMutableArray<NSTrackingArea *> *inside) {
  if (view.isHidden) return;
  for (NSTrackingArea *area in view.trackingAreas) {
    if (!(area.options & NSTrackingMouseEnteredAndExited)) continue;
    NSRect rect = (area.options & NSTrackingInVisibleRect) ? view.visibleRect : area.rect;
    if (NSPointInRect([view convertPoint:location fromView:nil], rect)) [inside addObject:area];
  }
  for (NSView *child in view.subviews) SparkAreasAt(child, location, inside);
}
// Moves the driver's pointer: mouseExited for tracking areas it leaves, a mouse moved (or dragged) event, and
// mouseEntered for areas it enters, as the window server reports a real pointer's moves. The driver treats the
// target window as the key window of the active app, so every entered-and-exited tracking area is active; while
// dragging, only those enabled during mouse drags (NSTrackingEnabledDuringMouseDrag) change.
static NSArray<NSEvent *> *SparkMove(NSWindow *window, NSPoint location, NSEventType type, NSEventModifierFlags flags) {
  SparkDriverCursorMoved();
  NSMutableArray<NSTrackingArea *> *inside = [NSMutableArray new];
  SparkAreasAt(SparkDriverFrameView(window), location, inside);
  BOOL dragging = type == NSEventTypeLeftMouseDragged;
  auto tracked = ^BOOL(NSTrackingArea *area) { return !dragging || (area.options & NSTrackingEnabledDuringMouseDrag); };
  NSMutableArray<NSEvent *> *events = [NSMutableArray new];
  auto edge = ^(NSEventType kind, NSTrackingArea *area, NSWindow *owner) {
    [events addObject:[NSEvent enterExitEventWithType:kind location:location modifierFlags:flags timestamp:SparkEventTime() windowNumber:owner.windowNumber
      context:nil eventNumber:clickNumber trackingNumber:(NSInteger)(__bridge void *)area userData:NULL]];
  };
  for (NSTrackingArea *area in [[hovered keyEnumerator] allObjects]) if (tracked(area) && ![inside containsObject:area]) {
    edge(NSEventTypeMouseExited, area, [hovered objectForKey:area] ?: window);
    [hovered removeObjectForKey:area];
  }
  [events addObject:SparkMouse(type, window, location, flags, 0)];
  for (NSTrackingArea *area in inside) if (tracked(area) && ![hovered objectForKey:area]) {
    edge(NSEventTypeMouseEntered, area, window);
    [hovered setObject:window forKey:area];
  }
  return events;
}

static BOOL SparkInteger(id value, NSInteger fallback, NSInteger min, NSInteger max, NSInteger *result) {
  if (!value) { *result = fallback; return YES; }
  if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() || [value doubleValue] != [value integerValue]) return NO;
  *result = [value integerValue];
  return *result >= min && *result <= max;
}
static BOOL SparkNumber(id value) { return !value || ([value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() && isfinite([value doubleValue])); }

// The window and point (window coordinates) a target addresses: `testID`, the first visible view with that testID
// (`offset` {x, y} points from its top-left, else its center); or `point` {x, y} in waitFor frame coordinates
// (points from the top-left of the window's frame view) of `window` (main by default). Points are points at any
// backing scale. As XCUITest and Playwright do, a testID target that the pointer acts at (`reach`) is scrolled into
// view first, and the point must reach it: it must hit-test to the view or one of its descendants, not to something
// covering it. A drag's end is not reached; the pointer only passes over it.
static NSWindow *SparkTarget(NSDictionary *target, id windowName, BOOL reach, NSPoint *location, NSDictionary **failure) {
  if (![target isKindOfClass:NSDictionary.class] || (target[@"testID"] != nil) == (target[@"point"] != nil)) {
    *failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"A target has testID, or point (with window)");
    return nil;
  }
  id testID = target[@"testID"], point = target[@"point"];
  if (testID) {
    NSView *view = [testID isKindOfClass:NSString.class] ? SparkDriverFindView(testID) : nil;
    if (!view) { *failure = SparkDriverFailure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No visible view with testID %@", testID]); return nil; }
    // The innermost view with the testID: the native control a React Native view hosts, as `elements` reports it.
    for (NSView *inner = view; inner;) {
      view = inner;
      inner = nil;
      for (NSView *child in view.subviews) if (!child.isHidden && (inner = SparkDriverFindTestID(child, testID))) break;
    }
    id offset = target[@"offset"], dx = [offset isKindOfClass:NSDictionary.class] ? offset[@"x"] : nil, dy = [offset isKindOfClass:NSDictionary.class] ? offset[@"y"] : nil;
    if (offset && (!SparkNumber(dx) || !SparkNumber(dy) || !dx || !dy)) { *failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"offset is {x, y} in points"); return nil; }
    if (reach) [view scrollRectToVisible:view.bounds];
    NSPoint inView = offset ? NSMakePoint([dx doubleValue], view.isFlipped ? [dy doubleValue] : NSHeight(view.bounds) - [dy doubleValue]) : NSMakePoint(NSMidX(view.bounds), NSMidY(view.bounds));
    *location = [view convertPoint:inView toView:nil];
    NSView *hit = [SparkDriverFrameView(view.window) hitTest:*location];
    if (reach && ![hit isDescendantOf:view]) {
      *failure = SparkDriverFailure(@"E_NOT_HITTABLE", [NSString stringWithFormat:@"A click on %@ at %@ would reach %@%@ instead", testID, NSStringFromPoint(inView),
        hit.className ?: @"nothing", hit.accessibilityIdentifier.length ? [NSString stringWithFormat:@" (%@)", hit.accessibilityIdentifier] : @""]);
      return nil;
    }
    return view.window;
  }
  id x = [point isKindOfClass:NSDictionary.class] ? point[@"x"] : nil, y = [point isKindOfClass:NSDictionary.class] ? point[@"y"] : nil;
  if (!SparkNumber(x) || !SparkNumber(y) || !x || !y) { *failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"point is {x, y} in points"); return nil; }
  NSString *problem = nil;
  NSWindow *window = SparkDriverResolveWindow(windowName ?: @"main", &problem);
  if (!window) { *failure = SparkDriverFailure(@"E_NO_WINDOW", problem); return nil; }
  NSView *frame = SparkDriverFrameView(window);
  NSPoint topLeft = NSMakePoint([x doubleValue], [y doubleValue]);
  if (!NSPointInRect(topLeft, NSMakeRect(0, 0, NSWidth(frame.bounds), NSHeight(frame.bounds)))) {
    *failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Point %@ is outside the window (%@)", NSStringFromPoint(topLeft), NSStringFromSize(frame.bounds.size)]);
    return nil;
  }
  // waitFor frames are y-down from the frame view's top-left; window coordinates are the frame view's, y-up.
  *location = [frame convertPoint:frame.isFlipped ? topLeft : NSMakePoint(topLeft.x, NSHeight(frame.bounds) - topLeft.y) toView:nil];
  return window;
}

#pragma mark Delivery

// Dispatches a command's events in order. Pointer events are posted to the queue first and then dispatched through
// -[NSApplication sendEvent:], so a tracking loop started by one of them dequeues what it needs itself. Key events
// are routed to `window` directly (see the top of this file; the queue also drops characters outside the Basic
// Multilingual Plane, such as emoji). `done` runs once: when everything has been dispatched, or earlier when the
// app enters a nested run loop (a modal loop) while handling the last event.
static void SparkDeliver(NSWindow *window, NSArray<NSEvent *> *events, void (^done)(NSString *failure)) {
  NSTimeInterval last = events.lastObject.timestamp;
  __block BOOL routingLast = NO, finished = NO;
  __block NSMenu *menu = nil;
  void (^finish)(NSString *) = ^(NSString *failure) {
    if (finished) return;
    finished = YES;
    done(failure);
  };
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(NULL, kCFRunLoopEntry, true, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    if (!menu && (routingLast || fabs(NSApp.currentEvent.timestamp - last) < 1e-6)) finish(nil);
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  id tracking = [NSNotificationCenter.defaultCenter addObserverForName:NSMenuDidBeginTrackingNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    menu = note.object;
    CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{ [menu cancelTrackingWithoutAnimation]; });
    CFRunLoopWakeUp(CFRunLoopGetMain());
  }];
  NSMutableArray<NSEvent *> *queued = [NSMutableArray new];
  void (^dispatchQueued)(void) = ^{
    for (NSEvent *event in queued) [NSApp postEvent:event atStart:NO];
    [queued removeAllObjects];
    for (NSEvent *event; (event = [NSApp nextEventMatchingMask:SparkPointerMask untilDate:nil inMode:SparkInputMode dequeue:YES]);) [NSApp sendEvent:event];
  };
  for (NSEvent *event in events) {
    NSEventMask mask = NSEventMaskFromType(event.type);
    if (!(mask & (SparkKeyMask | SparkGestureMask))) { [queued addObject:event]; continue; }
    dispatchQueued();
    routingLast = event == events.lastObject;
    if (mask & SparkKeyMask) SparkRouteKey(event, window);
    else [window sendEvent:event];
  }
  dispatchQueued();
  [NSNotificationCenter.defaultCenter removeObserver:tracking];
  CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
  finish(menu ? [NSString stringWithFormat:@"The input opened the native menu \"%@\", which the driver closed: menus need the black-box backend", menu.title] : nil);
}

static NSArray<NSEvent *> *SparkClick(NSWindow *window, NSPoint location, NSInteger button, NSInteger clicks, NSEventModifierFlags flags, NSDictionary **failure) {
  NSMutableArray<NSEvent *> *events = [SparkMove(window, location, NSEventTypeMouseMoved, flags) mutableCopy];
  for (NSInteger click = 1; click <= clicks; click++) {
    NSEvent *down = SparkButton(YES, button, window, location, flags, click), *up = SparkButton(NO, button, window, location, flags, click);
    if (!down || !up) {
      *failure = SparkDriverFailure(@"E_UNSUPPORTED", [NSString stringWithFormat:@"Mouse button %ld synthesis is unsupported on macOS %@: AppKit's event is not at the target", (long)button, NSProcessInfo.processInfo.operatingSystemVersionString]);
      return nil;
    }
    [events addObject:down];
    [events addObject:up];
  }
  return events;
}
// A trackpad gesture over `location`, after moving the driver's pointer there. Magnify and rotate begin, change in
// `steps` equal parts of the total, and end. A pressure gesture is a click whose pressure rises through stage 1 (a
// click) and, for `stage` 2, into stage 2 (a force click), then falls before the release.
static NSArray<NSEvent *> *SparkGestureEvents(NSWindow *window, NSPoint location, NSString *kind, NSDictionary *request, NSInteger steps, NSEventModifierFlags flags, NSDictionary **failure) {
  NSMutableArray<NSEvent *> *events = [SparkMove(window, location, NSEventTypeMouseMoved, flags) mutableCopy];
  __block NSString *problem = nil;
  auto gesture = ^(int64_t type, NSEventPhase phase, NSDictionary *values) {
    NSEvent *event = problem ? nil : SparkGesture(window, location, flags, type, phase, values, &problem);
    if (event) [events addObject:event];
  };
  if ([kind isEqual:@"magnify"] || [kind isEqual:@"rotate"]) {
    BOOL magnify = [kind isEqual:@"magnify"];
    NSNumber *field = @(magnify ? SparkGestureMagnification : SparkGestureRotation);
    double total = [request[magnify ? @"magnification" : @"rotation"] doubleValue];
    gesture(magnify ? 8 : 5, NSEventPhaseBegan, @{ field: @0 });
    for (NSInteger step = 0; step < steps; step++) gesture(magnify ? 8 : 5, NSEventPhaseChanged, @{ field: @(total / steps) });
    gesture(magnify ? 8 : 5, NSEventPhaseEnded, @{ field: @0 });
  } else if ([kind isEqual:@"swipe"]) {
    // IOHIDSwipeMask: up 1, down 2, left 4, right 8.
    gesture(16, NSEventPhaseNone, @{ @(SparkGestureSwipe): @{ @"up": @1, @"down": @2, @"left": @4, @"right": @8 }[request[@"direction"]] });
  } else if ([kind isEqual:@"smartMagnify"]) {
    gesture(22, NSEventPhaseNone, @{});
  } else {
    NSInteger stage = [request[@"stage"] ?: @2 integerValue];
    [events addObject:SparkButton(YES, 0, window, location, flags, 1)];
    auto pressure = ^(NSInteger at, double value, double transition, NSEventPhase phase) {
      gesture(32, phase, @{ @(SparkGestureStage): @(at), @(SparkGesturePressure): @(value), @(SparkGestureStageTransition): @(transition) });
    };
    pressure(1, 0.25, 0, NSEventPhaseBegan);
    pressure(1, 0.5, 0, NSEventPhaseChanged);
    pressure(1, 1, stage == 2 ? 0.5 : 0, NSEventPhaseChanged);
    if (stage == 2) pressure(2, 0.5, 0, NSEventPhaseChanged);
    pressure(0, 0, 0, NSEventPhaseEnded);
    [events addObject:SparkButton(NO, 0, window, location, flags, 1)];
  }
  if (!problem) return events;
  *failure = SparkDriverFailure(@"E_UNSUPPORTED", problem);
  return nil;
}
// The driver's pointer: its window and location there, after a pointer command.
static NSWindow *SparkPointerWindow(NSPoint *location, NSDictionary **failure) {
  NSWindow *window = focus;
  if (!window || isnan(pointer.x)) { *failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"The driver's pointer has not moved yet: give a target"); return nil; }
  *location = [window convertPointFromScreen:pointer];
  return window;
}
static NSArray<NSEvent *> *SparkDrag(NSWindow *window, NSPoint from, NSPoint to, NSInteger steps, NSEventModifierFlags flags) {
  NSMutableArray<NSEvent *> *events = [SparkMove(window, from, NSEventTypeMouseMoved, flags) mutableCopy];
  [events addObject:SparkMouse(NSEventTypeLeftMouseDown, window, from, flags, 1)];
  for (NSInteger step = 1; step <= steps; step++) {
    CGFloat t = (CGFloat)step / steps;
    [events addObjectsFromArray:SparkMove(window, NSMakePoint(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t), NSEventTypeLeftMouseDragged, flags)];
  }
  [events addObject:SparkMouse(NSEventTypeLeftMouseUp, window, to, flags, 1)];
  return events;
}

// The window key input goes to: `window`, else the window of the last pointer input, else main.
static NSWindow *SparkKeyWindow(id name, NSDictionary **failure) {
  if (!name && focus) return focus;
  NSString *problem = nil;
  NSWindow *window = SparkDriverResolveWindow(name ?: @"main", &problem);
  if (!window) *failure = SparkDriverFailure(@"E_NO_WINDOW", problem);
  return window;
}

void SparkDriverInput(NSString *command, NSDictionary *request, SparkTestDriverReply reply) {
  NSDictionary *failure = nil;
  NSArray<NSEvent *> *events = nil;
  NSEventModifierFlags flags = 0;
  NSPoint location, to;
  NSWindow *window = nil;
  auto invalid = ^(NSString *message) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", message)); };
  // A pointer command's window goes on screen before its events are made (see the top of this file).
  BOOL press = [command isEqual:@"tap"] || [command isEqual:@"drag"] || [request[@"kind"] isEqual:@"pressure"];
  __block dispatch_block_t restore = ^{};
  auto present = ^(NSWindow *target, NSPoint at) { restore = SparkPresent(target, press ? &at : NULL); };
  if (!SparkParseModifiers(request[@"modifiers"], &flags)) { invalid(@"modifiers is a list of cmd, ctrl, option, shift and fn"); return; }
  if ([command isEqual:@"tap"]) {
    NSInteger clicks;
    NSNumber *button = @{ @"left": @0, @"right": @1, @"back": @3, @"forward": @4 }[request[@"button"] ?: @"left"];
    if (!button) { invalid(@"button is left, right, back or forward"); return; }
    NSString *missing = button.integerValue > 1 ? SparkDriverPrivateEventsMissing() : nil;
    if (missing) { reply(SparkDriverFailure(@"E_UNSUPPORTED", missing)); return; }
    if (!SparkInteger(request[@"clickCount"], 1, 1, 3, &clicks)) { invalid(@"clickCount is 1, 2 or 3"); return; }
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) { present(window, location); events = SparkClick(window, location, button.integerValue, clicks, flags, &failure); }
  } else if ([command isEqual:@"hover"]) {
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) { present(window, location); events = SparkMove(window, location, NSEventTypeMouseMoved, flags); }
  } else if ([command isEqual:@"drag"]) {
    NSInteger steps;
    if (!SparkInteger(request[@"steps"], 10, 1, 500, &steps)) { invalid(@"steps is 1-500"); return; }
    NSWindow *end = nil;
    if ((window = SparkTarget(request[@"from"], request[@"window"], YES, &location, &failure)) && (end = SparkTarget(request[@"to"], request[@"window"], NO, &to, &failure))) {
      if (end != window) failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"from and to are in different windows");
      else { present(window, location); events = SparkDrag(window, location, to, steps, flags); }
    }
  } else if ([command isEqual:@"scroll"]) {
    id dx = request[@"deltaX"], dy = request[@"deltaY"], precise = request[@"precise"] ?: @NO;
    if (!SparkNumber(dx) || !SparkNumber(dy) || (!dx && !dy)) { invalid(@"scroll needs deltaX and/or deltaY in points (precise) or lines"); return; }
    if (precise != (id)kCFBooleanTrue && precise != (id)kCFBooleanFalse) { invalid(@"precise is a boolean"); return; }
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) {
      present(window, location);
      NSMutableArray *move = [SparkMove(window, location, NSEventTypeMouseMoved, flags) mutableCopy];
      [move addObject:SparkScroll(window, location, flags, [dx doubleValue], [dy doubleValue], [precise boolValue])];
      events = move;
    }
  } else if ([command isEqual:@"gesture"]) {
    NSString *kind = request[@"kind"];
    NSInteger steps, stage;
    if (![@[@"magnify", @"rotate", @"swipe", @"smartMagnify", @"pressure"] containsObject:kind ?: @""]) { invalid(@"kind is magnify, rotate, swipe, smartMagnify or pressure"); return; }
    if (NSString *missing = SparkDriverPrivateEventsMissing()) { reply(SparkDriverFailure(@"E_UNSUPPORTED", missing)); return; }
    if (!SparkInteger(request[@"steps"], 10, 1, 100, &steps)) { invalid(@"steps is 1-100"); return; }
    id magnification = request[@"magnification"], rotation = request[@"rotation"];
    if ([kind isEqual:@"magnify"] && (!magnification || !SparkNumber(magnification) || [magnification doubleValue] <= -1 || [magnification doubleValue] == 0)) { invalid(@"magnification is a nonzero scale change greater than -1"); return; }
    if ([kind isEqual:@"rotate"] && (!rotation || !SparkNumber(rotation) || [rotation doubleValue] == 0)) { invalid(@"rotation is nonzero degrees, counterclockwise positive"); return; }
    if ([kind isEqual:@"swipe"] && ![@[@"left", @"right", @"up", @"down"] containsObject:request[@"direction"] ?: @""]) { invalid(@"direction is left, right, up or down"); return; }
    if ([kind isEqual:@"pressure"] && !SparkInteger(request[@"stage"], 2, 1, 2, &stage)) { invalid(@"stage is 1 (click) or 2 (force click)"); return; }
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) { present(window, location); events = SparkGestureEvents(window, location, kind, request, steps, flags, &failure); }
  } else if ([command isEqual:@"cursor"]) {
    BOOL targeted = request[@"testID"] || request[@"point"];
    window = targeted ? SparkTarget(request, request[@"window"], YES, &location, &failure) : SparkPointerWindow(&location, &failure);
    if (!window) { reply(failure); return; }
    NSMutableDictionary *result = [SparkDriverCursorAt(window, location) mutableCopy];
    result[@"ok"] = @YES;
    reply(result);
    return;
  } else if ([command isEqual:@"pressKey"]) {
    NSString *key = request[@"key"];
    if (![key isKindOfClass:NSString.class] || key.length != 1) { invalid(@"key is one character: a character key, or AppKit's character for a function key"); return; }
    if ((window = SparkKeyWindow(request[@"window"], &failure))) events = SparkPress(window, key, flags);
  } else if ([command isEqual:@"typeText"]) {
    NSString *text = request[@"text"];
    if (![text isKindOfClass:NSString.class] || !text.length) { invalid(@"typeText expects text"); return; }
    if ((window = SparkKeyWindow(request[@"window"], &failure))) {
      NSMutableArray *typed = [NSMutableArray new];
      // One key press per user-perceived character; a newline presses Return.
      [text enumerateSubstringsInRange:NSMakeRange(0, text.length) options:NSStringEnumerationByComposedCharacterSequences usingBlock:^(NSString *character, NSRange, NSRange, BOOL *) {
        [typed addObjectsFromArray:SparkPress(window, [character isEqual:@"\n"] ? @"\r" : character, 0)];
      }];
      events = typed;
    }
  }
  if (!events) { restore(); reply(failure); return; }
  SparkDeliver(window, events, ^(NSString *menu) { reply(menu ? SparkDriverFailure(@"E_MENU", menu) : @{ @"ok": @YES }); });
  restore();
}
