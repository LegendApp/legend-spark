#import <React/RCTViewComponentView.h>
#import <AppKit/AppKit.h>

// A React Native view with a custom cursor that reports trackpad gestures, pressure and the back and forward mouse
// buttons (docs/pointer.md). Each instance owns its cursor and handled event types; nothing is shared.
@interface RNSparkPointerView : RCTViewComponentView
@end
