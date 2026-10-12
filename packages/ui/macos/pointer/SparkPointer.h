#import <AppKit/AppKit.h>

// AppKit pointer services behind @legendapp/spark/pointer (docs/pointer.md), free of React Native so the harness
// in tests/pointer.native.mm drives them directly. Main thread only.

// Performs haptic feedback through `performer` (NSHapticFeedbackManager.defaultPerformer in the app): `pattern` is
// generic, alignment or levelChange; `time` is default, now or drawCompleted. NO for any other value.
FOUNDATION_EXPORT BOOL SparkPointerPerformHaptic(id<NSHapticFeedbackPerformer> performer, NSString *pattern, NSString *time);

// A custom cursor: `type` symbol (an SF Symbol `name` at `pointSize`, hot spot at its center unless given) or image
// (an image file at the absolute path `name`, at its size in points, with a hot spot). The image's accessibility
// description is the symbol name or file name. nil, with `error` set, when the image cannot be loaded.
FOUNDATION_EXPORT NSCursor *SparkPointerCursor(NSString *type, NSString *name, CGFloat pointSize, BOOL hasHotSpot, NSPoint hotSpot, NSString **error);

// What a pointer event reports to JavaScript in `view`: `type` (magnify, rotate, swipe, smartMagnify, pressure,
// mouseButton), `x` and `y` (points from the view's top-left) and the type's fields: magnify `magnification` and
// `phase`; rotate `rotation` (degrees, clockwise) and `phase`; swipe `direction`; pressure `pressure`, `stage` and
// `stageTransition`; mouseButton `button` (back or forward, on release). nil for any other event, including other
// mouse buttons and presses of back and forward.
FOUNDATION_EXPORT NSDictionary *SparkPointerEvent(NSEvent *event, NSView *view);
