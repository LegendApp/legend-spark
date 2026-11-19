#import <AppKit/AppKit.h>

static inline void RNSparkScheduleSplitViewUpdate(dispatch_block_t update)
{
  [NSRunLoop.mainRunLoop performInModes:@[NSDefaultRunLoopMode, NSModalPanelRunLoopMode] block:update];
}
