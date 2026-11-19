#import <AppKit/AppKit.h>
#include <string>
#include <vector>

struct RNSparkSplitPaneSizing {
  std::string id;
  CGFloat initialSize;
  CGFloat minSize;
  CGFloat maxSize;
};

@interface RNSparkPaneSplitView : NSSplitView
@property (nonatomic, copy, nullable) void (^onLayout)(void);
- (void)configurePanes:(const std::vector<RNSparkSplitPaneSizing> &)panes
            horizontal:(BOOL)horizontal
          dividerStyle:(NSSplitViewDividerStyle)style;
@end
