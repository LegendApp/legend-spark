#import "SparkTestDriver.h"

// Shared by the driver's protocol (SparkTestDriver.mm) and its input synthesis (SparkTestDriverInput.mm).
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
