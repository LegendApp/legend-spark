#import "SparkTestDriver.h"

// Private CoreGraphics event functions and QuartzCore SPI compile only with this flag (docs/test-driver.md#private-event-functions).
#ifndef SPARK_TEST_DRIVER_PRIVATE_EVENTS
#define SPARK_TEST_DRIVER_PRIVATE_EVENTS 0
#endif

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
// The view's frame in points from the top-left of its window's frame view: {x, y, width, height}.
NSDictionary *SparkDriverFrame(NSView *view);
// An NSAccessibility role without AX ("AXButton" is "button"); nil for none or the unknown role.
NSString *SparkDriverRoleName(id role);
// What `capture` renders: the window's frame view, inside the modules' render wrappers; nil with `failure` set otherwise.
NSBitmapImageRep *SparkDriverRenderWindow(NSWindow *window, NSString **failure);
// 1-100 of [A-Za-z0-9_-], not starting with -.
BOOL SparkDriverCaptureName(id name);
// Creates `file` (a capture name plus extension) in the run directory, never overwriting; 0 or an errno.
int SparkDriverWriteCapture(NSString *file, NSData *data);

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

// Copied events (SparkTestDriverInput.mm): the event a changed copy of an AppKit mouse event (a gesture, another mouse
// button) makes at that mouse event's location (nil when AppKit's location is off, or this macOS lacks the private functions), and why `event`
// is not the gesture with these private fields (HID type, phase, values) at `location`, or nil when it is.
NSEvent *SparkDriverLocated(CGEventRef prototype, NSEvent *mouse);
// Why this build has no gesture or extra mouse button synthesis (built without SPARK_TEST_DRIVER_PRIVATE_EVENTS), or nil.
NSString *SparkDriverPrivateEventsMissing(void);
NSString *SparkDriverCheckGesture(NSEvent *event, NSWindow *window, NSPoint location, int64_t hidType, NSEventPhase phase, NSDictionary<NSNumber *, NSNumber *> *values);

// Waits until mounted UI updates have settled (100 ms without a mount), at most `timeoutMs` (a number, else 5 s).
void SparkDriverWhenSettled(id timeoutMs, void (^done)(BOOL settled));
// Commit watching, leak counters and memory (SparkTestDriverCommits.mm): startCommits, stopCommits, counters, memory.
NSArray<NSString *> *SparkDriverCommitCommandNames(void);
void SparkDriverCommits(NSString *command, NSDictionary *request, SparkTestDriverReply reply);
// Accessibility audit facts (SparkTestDriverAudit.mm): accessibilityAudit.
NSArray<NSString *> *SparkDriverAuditCommandNames(void);
void SparkDriverAudit(NSDictionary *request, SparkTestDriverReply reply);
