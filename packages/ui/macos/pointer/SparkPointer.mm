#import "SparkPointer.h"

BOOL SparkPointerPerformHaptic(id<NSHapticFeedbackPerformer> performer, NSString *pattern, NSString *time) {
  NSNumber *feedback = @{ @"generic": @(NSHapticFeedbackPatternGeneric), @"alignment": @(NSHapticFeedbackPatternAlignment), @"levelChange": @(NSHapticFeedbackPatternLevelChange) }[pattern];
  NSNumber *when = @{ @"default": @(NSHapticFeedbackPerformanceTimeDefault), @"now": @(NSHapticFeedbackPerformanceTimeNow), @"drawCompleted": @(NSHapticFeedbackPerformanceTimeDrawCompleted) }[time];
  if (!feedback || !when) return NO;
  // Without a Force Touch trackpad the performer does nothing; AppKit offers no way to tell.
  [performer performFeedbackPattern:(NSHapticFeedbackPattern)feedback.integerValue performanceTime:(NSHapticFeedbackPerformanceTime)when.unsignedIntegerValue];
  return YES;
}

NSCursor *SparkPointerCursor(NSString *type, NSString *name, CGFloat pointSize, BOOL hasHotSpot, NSPoint hotSpot, NSString **error) {
  NSImage *image = nil;
  if ([type isEqual:@"symbol"]) {
    image = [[NSImage imageWithSystemSymbolName:name accessibilityDescription:name] imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:pointSize weight:NSFontWeightRegular]];
    if (!image) { *error = [NSString stringWithFormat:@"No SF Symbol named %@", name]; return nil; }
  } else if ([type isEqual:@"image"]) {
    image = [[NSImage alloc] initWithContentsOfFile:name];
    if (!image || !image.isValid) { *error = [NSString stringWithFormat:@"No image could be read from %@", name]; return nil; }
    image.accessibilityDescription = name.lastPathComponent;
  } else {
    *error = [NSString stringWithFormat:@"Unknown cursor type %@", type];
    return nil;
  }
  NSPoint spot = hasHotSpot ? hotSpot : NSMakePoint(image.size.width / 2, image.size.height / 2);
  if (spot.x < 0 || spot.y < 0 || spot.x >= image.size.width || spot.y >= image.size.height) {
    *error = [NSString stringWithFormat:@"The hot spot %@ is outside the %@ cursor image", NSStringFromPoint(spot), NSStringFromSize(image.size)];
    return nil;
  }
  return [[NSCursor alloc] initWithImage:image hotSpot:spot];
}

static NSString *SparkPhase(NSEventPhase phase) {
  switch (phase) {
    case NSEventPhaseNone: return @"none";
    case NSEventPhaseBegan: return @"began";
    case NSEventPhaseStationary: return @"stationary";
    case NSEventPhaseChanged: return @"changed";
    case NSEventPhaseEnded: return @"ended";
    case NSEventPhaseCancelled: return @"cancelled";
    case NSEventPhaseMayBegin: return @"mayBegin";
    default: return nil;
  }
}

NSDictionary *SparkPointerEvent(NSEvent *event, NSView *view) {
  NSPoint point = [view convertPoint:event.locationInWindow fromView:nil];
  NSMutableDictionary *result = [@{ @"x": @(point.x), @"y": @(view.isFlipped ? point.y : NSHeight(view.bounds) - point.y) } mutableCopy];
  switch (event.type) {
    case NSEventTypeMagnify:
    case NSEventTypeRotate: {
      NSString *phase = SparkPhase(event.phase);
      if (!phase) return nil;
      BOOL magnify = event.type == NSEventTypeMagnify;
      result[@"type"] = magnify ? @"magnify" : @"rotate";
      // AppKit's rotation is counterclockwise; React Native's rotate transform is clockwise.
      result[magnify ? @"magnification" : @"rotation"] = @(magnify ? event.magnification : -event.rotation);
      result[@"phase"] = phase;
      return result;
    }
    case NSEventTypeSwipe: {
      // AppKit reports a swipe to the left or up as a positive delta.
      NSString *direction = event.deltaX > 0 ? @"left" : event.deltaX < 0 ? @"right" : event.deltaY > 0 ? @"up" : event.deltaY < 0 ? @"down" : nil;
      if (!direction) return nil;
      result[@"type"] = @"swipe";
      result[@"direction"] = direction;
      return result;
    }
    case NSEventTypeSmartMagnify:
      result[@"type"] = @"smartMagnify";
      return result;
    case NSEventTypePressure:
      result[@"type"] = @"pressure";
      result[@"pressure"] = @(event.pressure);
      result[@"stage"] = @(event.stage);
      result[@"stageTransition"] = @(event.stageTransition);
      return result;
    case NSEventTypeOtherMouseUp:
      if (event.buttonNumber != 3 && event.buttonNumber != 4) return nil;
      result[@"type"] = @"mouseButton";
      result[@"button"] = event.buttonNumber == 3 ? @"back" : @"forward";
      return result;
    default:
      return nil;
  }
}
