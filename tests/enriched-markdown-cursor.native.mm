#import <AppKit/AppKit.h>
#include <TargetConditionals.h>
#define ENRMPlatformTextView NSTextView

// ACTUAL_IMPLEMENTATION

@interface Overlay : NSView
@end
@implementation Overlay
- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor]; }
@end

int main()
{
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    ENRMContextMenuTextView *text = [[ENRMContextMenuTextView alloc] initWithFrame:window.contentView.bounds];
    text.editable = NO;
    [window.contentView addSubview:text];
    Overlay *overlay = [[Overlay alloc] initWithFrame:NSMakeRect(10, 10, 100, 50)];
    [overlay addSubview:[[NSView alloc] initWithFrame:NSMakeRect(5, 5, 20, 20)]];
    [window.contentView addSubview:overlay];
    [window orderFront:nil];
    [window resetCursorRects];
    // AppKit's enter path leaves the covered text's I-beam; the next move must restore the overlay's cursor.
    [NSCursor.IBeamCursor set];
    [text mouseMoved:[NSEvent mouseEventWithType:NSEventTypeMouseMoved location:NSMakePoint(20, 20) modifierFlags:0 timestamp:0
                                     windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:0 pressure:0]];
    if (NSCursor.currentCursor != NSCursor.pointingHandCursor) {
      fputs("covered text kept its own cursor over the overlay\n", stderr);
      return 1;
    }
    puts("ENRM cursor probe passed");
  }
}
