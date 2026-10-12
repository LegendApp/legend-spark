#import <React/RCTViewComponentView.h>
#import <AppKit/AppKit.h>

// An NSTabView whose items host SparkTab children, in React order.
@interface RNSparkTabView : RCTViewComponentView <NSTabViewDelegate>
@end

// One tab: its NSTabViewItem's flipped content view hosts this view and its React children.
@interface RNSparkTab : RCTViewComponentView
@end
