#import "RNSparkPointerView.h"
#import "SparkPointer.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@implementation RNSparkPointerView {
  NSCursor *_cursor;
  NSSet<NSString *> *_handled;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkPointerViewProps>();
    _handled = [NSSet set];
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<SparkPointerViewProps const>(props);
  // Fabric mounts (Insert mutations) pass a null oldProps; with nothing to diff against, apply every prop.
  const auto previous = std::static_pointer_cast<SparkPointerViewProps const>(oldProps);
  NSMutableSet *handled = [NSMutableSet new];
  for (const auto &type : next.handledEvents) [handled addObject:[NSString stringWithUTF8String:type.c_str()]];
  _handled = handled;
  if (!previous || next.cursorType != previous->cursorType || next.cursorName != previous->cursorName || next.cursorPointSize != previous->cursorPointSize ||
      next.cursorHasHotSpot != previous->cursorHasHotSpot || next.cursorHotSpotX != previous->cursorHotSpotX || next.cursorHotSpotY != previous->cursorHotSpotY) {
    NSString *type = [NSString stringWithUTF8String:next.cursorType.c_str()], *error = nil;
    _cursor = type.length ? SparkPointerCursor(type, [NSString stringWithUTF8String:next.cursorName.c_str()], next.cursorPointSize, next.cursorHasHotSpot,
      NSMakePoint(next.cursorHotSpotX, next.cursorHotSpotY), &error) : nil;
    if (error) [self reportError:error];
    [self.window invalidateCursorRectsForView:self];
  }
  [super updateProps:props oldProps:oldProps];
}

// The custom cursor covers the view; a descendant's own cursor (style cursor) still wins over it.
- (void)resetCursorRects {
  if (!_cursor) { [super resetCursorRects]; return; }
  [self discardCursorRects];
  [self addCursorRect:self.bounds cursor:_cursor];
}

#pragma mark Events

// YES when the event was reported; otherwise the caller passes it on as the view would have.
- (BOOL)report:(NSEvent *)event {
  NSDictionary *input = SparkPointerEvent(event, self);
  const auto emitter = std::static_pointer_cast<const SparkPointerViewEventEmitter>(_eventEmitter);
  if (!input || ![_handled containsObject:input[@"type"]] || !emitter) return NO;
  emitter->onPointerInput({
    .type = [input[@"type"] UTF8String], .x = [input[@"x"] doubleValue], .y = [input[@"y"] doubleValue],
    .magnification = [input[@"magnification"] doubleValue], .rotation = [input[@"rotation"] doubleValue], .phase = [input[@"phase"] ?: @"" UTF8String],
    .direction = [input[@"direction"] ?: @"" UTF8String], .pressure = [input[@"pressure"] doubleValue], .stage = [input[@"stage"] intValue],
    .stageTransition = [input[@"stageTransition"] doubleValue], .button = [input[@"button"] ?: @"" UTF8String],
  });
  return YES;
}
- (void)reportError:(NSString *)message {
  const auto emitter = std::static_pointer_cast<const SparkPointerViewEventEmitter>(_eventEmitter);
  if (emitter) emitter->onPointerViewError({ .code = "E_INVALID_ARGUMENT", .message = message.UTF8String });
}
- (void)magnifyWithEvent:(NSEvent *)event { if (![self report:event]) [super magnifyWithEvent:event]; }
- (void)rotateWithEvent:(NSEvent *)event { if (![self report:event]) [super rotateWithEvent:event]; }
- (void)swipeWithEvent:(NSEvent *)event { if (![self report:event]) [super swipeWithEvent:event]; }
- (void)smartMagnifyWithEvent:(NSEvent *)event { if (![self report:event]) [super smartMagnifyWithEvent:event]; }
- (void)pressureChangeWithEvent:(NSEvent *)event { if (![self report:event]) [super pressureChangeWithEvent:event]; }
// Back and forward report on release, as browsers navigate; their press is taken so the release comes here.
- (BOOL)handlesButton:(NSEvent *)event { return (event.buttonNumber == 3 || event.buttonNumber == 4) && [_handled containsObject:@"mouseButton"]; }
- (void)otherMouseDown:(NSEvent *)event { if (![self handlesButton:event]) [super otherMouseDown:event]; }
- (void)otherMouseUp:(NSEvent *)event { if (![self handlesButton:event] || ![self report:event]) [super otherMouseUp:event]; }

- (void)prepareForRecycle {
  _cursor = nil;
  _handled = [NSSet set];
  [super prepareForRecycle];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkPointerViewComponentDescriptor>(); }
@end
