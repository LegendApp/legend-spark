#import "SparkTestDriver.h"

// Shared by the driver's protocol (SparkTestDriver.mm), its input synthesis (SparkTestDriverInput.mm) and its cursor
// state (SparkTestDriverCursor.mm).
// Main thread only.
NSDictionary *SparkDriverFailure(NSString *code, NSString *message);
// The window's frame view (contentView.superview): the area `capture` renders and `waitFor` frames are relative to.
NSView *SparkDriverFrameView(NSWindow *window);
// The first visible view with this accessibility identifier (React Native testID) in `view`'s subtree, or in any window.
NSView *SparkDriverFindTestID(NSView *view, NSString *testID);
NSView *SparkDriverFindView(NSString *testID);
// main, key, id:<identifier> or title:<title>; nil with `failure` set otherwise.
NSWindow *SparkDriverResolveWindow(id target, NSString **failure);

NSArray<NSString *> *SparkDriverInputCommandNames(void);
// Called once when the driver starts.
void SparkDriverInputStart(void);
void SparkDriverInput(NSString *command, NSDictionary *request, SparkTestDriverReply reply);

// Frame counting (SparkTestDriverFrames.mm): startFrames, stopFrames.
NSArray<NSString *> *SparkDriverFrameCommandNames(void);
void SparkDriverFrames(NSString *command, NSDictionary *request, SparkTestDriverReply reply);
// Records cursor hiding instead of applying it, and lets SparkDriverCursorAt ask views for their cursors. Called once.
void SparkDriverCursorStart(void);
// The driver's pointer moved, which ends +[NSCursor setHiddenUntilMouseMoves:].
void SparkDriverCursorMoved(void);
// The cursor AppKit would show at `location` (window coordinates): {cursor: name, hiddenUntilMoved}.
NSDictionary *SparkDriverCursorAt(NSWindow *window, NSPoint location);

// Gesture events (SparkTestDriverInput.mm): give a retyped event the locations of the AppKit mouse event it was copied
// from (NO when this macOS lacks the private functions), and why `event` is not the gesture with these private fields
// (HID type, phase, values) at `location`, or nil when it is.
BOOL SparkDriverSetGestureLocation(CGEventRef event, NSEvent *mouse);
NSString *SparkDriverCheckGesture(NSEvent *event, NSWindow *window, NSPoint location, int64_t hidType, NSEventPhase phase, NSDictionary<NSNumber *, NSNumber *> *values);
