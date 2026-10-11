#import "SparkTestDriverPrivate.h"

// In-process input for the test driver (docs/test-driver.md#input). The driver creates NSEvents and dispatches
// them through -[NSApplication sendEvent:] to this app's own windows. Nothing is posted to the system event
// stream: the real pointer and keyboard are untouched, other apps never see the events, and no TCC permission
// is involved. What AppKit does with such events, measured in tests/test-driver.native.mm, shapes this file:
//
// - NSWindow ignores mouse events for a window that is not on screen. For the duration of a pointer command the
//   driver orders a window that is not on screen in: fully transparent, ignoring real mouse events, behind every
//   other window, never activated. It orders it out again afterwards, because a window on screen that is not the
//   key window ignores key equivalents (a default button's Return), while one that is not on screen does not.
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

static NSString *const SparkInputMode = @"SparkTestDriverInput"; // No sources: dequeueing in it runs nothing else.
static const NSEventMask SparkPointerMask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged |
  NSEventMaskRightMouseDown | NSEventMaskRightMouseUp | NSEventMaskRightMouseDragged | NSEventMaskMouseMoved |
  NSEventMaskMouseEntered | NSEventMaskMouseExited | NSEventMaskScrollWheel;
static NSTimeInterval lastTime = 0;
static NSInteger clickNumber = 0; // Like the window server, a press and its drags and release share one event number.
static NSPoint pointer = { NAN, NAN }; // The driver's pointer, in screen coordinates. The real pointer never moves.
static __weak NSWindow *focus; // The window of the last pointer input: what a click makes the key window.
static NSMapTable<NSTrackingArea *, NSWindow *> *hovered; // Tracking areas the driver's pointer is inside.

NSArray<NSString *> *SparkDriverInputCommandNames(void) {
  static NSArray *names = @[@"tap", @"hover", @"drag", @"scroll", @"pressKey", @"typeText"];
  return names;
}

// Event times are unique, so the driver recognizes its last event after a round trip through the queue (which
// copies events), and 8 ms apart, a plausible input rate for velocity and double-click logic.
static NSTimeInterval SparkEventTime(void) { return lastTime = MAX(lastTime + 0.008, NSProcessInfo.processInfo.systemUptime); }

void SparkDriverInputStart(void) { hovered = [NSMapTable weakToWeakObjectsMapTable]; }
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
  BOOL down = type == NSEventTypeLeftMouseDown || type == NSEventTypeRightMouseDown;
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
  NSEventMask keys = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged;
  if (NSEventMaskFromType(events.firstObject.type) & keys) {
    for (NSEvent *event in events) {
      routingLast = event == events.lastObject;
      SparkRouteKey(event, window);
    }
  } else {
    for (NSEvent *event in events) [NSApp postEvent:event atStart:NO];
    for (NSEvent *event; (event = [NSApp nextEventMatchingMask:SparkPointerMask untilDate:nil inMode:SparkInputMode dequeue:YES]);) [NSApp sendEvent:event];
  }
  [NSNotificationCenter.defaultCenter removeObserver:tracking];
  CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
  finish(menu ? [NSString stringWithFormat:@"The input opened the native menu \"%@\", which the driver closed: menus need the black-box backend", menu.title] : nil);
}

static NSArray<NSEvent *> *SparkClick(NSWindow *window, NSPoint location, BOOL right, NSInteger clicks, NSEventModifierFlags flags) {
  NSMutableArray<NSEvent *> *events = [SparkMove(window, location, NSEventTypeMouseMoved, flags) mutableCopy];
  for (NSInteger click = 1; click <= clicks; click++) {
    [events addObject:SparkMouse(right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown, window, location, flags, click)];
    [events addObject:SparkMouse(right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp, window, location, flags, click)];
  }
  return events;
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
  if (!SparkParseModifiers(request[@"modifiers"], &flags)) { invalid(@"modifiers is a list of cmd, ctrl, option, shift and fn"); return; }
  if ([command isEqual:@"tap"]) {
    NSInteger clicks;
    id button = request[@"button"] ?: @"left";
    if (![button isEqual:@"left"] && ![button isEqual:@"right"]) { invalid(@"button is left or right"); return; }
    if (!SparkInteger(request[@"clickCount"], 1, 1, 3, &clicks)) { invalid(@"clickCount is 1, 2 or 3"); return; }
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) events = SparkClick(window, location, [button isEqual:@"right"], clicks, flags);
  } else if ([command isEqual:@"hover"]) {
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) events = SparkMove(window, location, NSEventTypeMouseMoved, flags);
  } else if ([command isEqual:@"drag"]) {
    NSInteger steps;
    if (!SparkInteger(request[@"steps"], 10, 1, 500, &steps)) { invalid(@"steps is 1-500"); return; }
    NSWindow *end = nil;
    if ((window = SparkTarget(request[@"from"], request[@"window"], YES, &location, &failure)) && (end = SparkTarget(request[@"to"], request[@"window"], NO, &to, &failure))) {
      if (end != window) failure = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"from and to are in different windows");
      else events = SparkDrag(window, location, to, steps, flags);
    }
  } else if ([command isEqual:@"scroll"]) {
    id dx = request[@"deltaX"], dy = request[@"deltaY"], precise = request[@"precise"] ?: @NO;
    if (!SparkNumber(dx) || !SparkNumber(dy) || (!dx && !dy)) { invalid(@"scroll needs deltaX and/or deltaY in points (precise) or lines"); return; }
    if (precise != (id)kCFBooleanTrue && precise != (id)kCFBooleanFalse) { invalid(@"precise is a boolean"); return; }
    if ((window = SparkTarget(request, request[@"window"], YES, &location, &failure))) {
      NSMutableArray *move = [SparkMove(window, location, NSEventTypeMouseMoved, flags) mutableCopy];
      [move addObject:SparkScroll(window, location, flags, [dx doubleValue], [dy doubleValue], [precise boolValue])];
      events = move;
    }
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
  if (!events) { reply(failure); return; }
  BOOL keys = [command isEqual:@"pressKey"] || [command isEqual:@"typeText"], press = [command isEqual:@"tap"] || [command isEqual:@"drag"];
  dispatch_block_t restore = keys ? ^{} : SparkPresent(window, press ? &location : NULL);
  SparkDeliver(window, events, ^(NSString *menu) { reply(menu ? SparkDriverFailure(@"E_MENU", menu) : @{ @"ok": @YES }); });
  restore();
}
