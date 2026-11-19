#import "RNSparkPaneSplitView.h"
#include <cmath>
#include <cstdlib>
#include <iostream>

static void expect(BOOL condition, const char *message)
{
  if (condition) return;
  std::cerr << message << std::endl;
  std::exit(1);
}

static void near(CGFloat actual, CGFloat expected, const char *message)
{
  if (std::abs(actual - expected) < 0.01) return;
  std::cerr << message << ": expected " << expected << ", got " << actual << std::endl;
  std::exit(1);
}

int main()
{
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 601, 380)
                                                  styleMask:NSWindowStyleMaskTitled
                                                    backing:NSBackingStoreBuffered defer:YES];
    auto *split = [[RNSparkPaneSplitView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:split];
    NSView *first = [NSView new];
    auto *nested = [[RNSparkPaneSplitView alloc] initWithFrame:NSZeroRect];
    NSView *last = [NSView new];
    NSView *top = [NSView new], *bottom = [NSView new];
    [nested addArrangedSubview:top];
    [nested addArrangedSubview:bottom];
    [nested configurePanes:{{"top", 120, 90, 180}, {"bottom", -1, 80, -1}}
               horizontal:NO dividerStyle:NSSplitViewDividerStylePaneSplitter];
    [split addArrangedSubview:first];
    [split addArrangedSubview:nested];
    [split addArrangedSubview:last];
    __block int updates = 0;
    split.onLayout = ^{ ++updates; };
    std::vector<RNSparkSplitPaneSizing> config{
      {"first", 150, 100, 210}, {"nested", 200, 120, 230}, {"last", -1, 100, -1}
    };
    [split configurePanes:config horizontal:YES dividerStyle:NSSplitViewDividerStyleThin];
    [window.contentView layoutSubtreeIfNeeded];
    expect(updates > 0, "initial layout publishes frames");
    near(NSWidth(first.frame), 150, "first initial size");
    near(NSWidth(nested.frame), 200, "middle initial size");
    near(NSMaxX(last.frame), 601, "all panes and dividers fill the split");
    near(NSHeight(top.frame), 120, "nested vertical initial size");
    near(NSMinY(bottom.frame), 120 + nested.dividerThickness, "vertical layout is top to bottom");
    expect(split.autosaveName == nil && nested.autosaveName == nil, "no autosave");
    expect(nested.dividerStyle == NSSplitViewDividerStylePaneSplitter, "native pane splitter style");

    int beforeMove = updates;
    [split setPosition:20 ofDividerAtIndex:0];
    near(NSWidth(first.frame), 120, "second pane max constrains first divider");
    near(NSWidth(nested.frame), 230, "second pane max size");
    near(NSWidth(last.frame), 249, "first divider leaves last pane alone");
    expect(updates > beforeMove, "divider movement publishes frames");

    [split setPosition:350 ofDividerAtIndex:0];
    near(NSWidth(first.frame), 210, "first pane max width clamps divider");
    near(NSWidth(nested.frame), 140, "adjacent pane absorbs drag");
    [split setPosition:335 ofDividerAtIndex:1];
    near(NSWidth(nested.frame), 124, "second divider adjusts the middle pane");
    near(NSWidth(first.frame), 210, "second divider leaves first pane alone");
    [nested setPosition:300 ofDividerAtIndex:0];
    near(NSHeight(top.frame), 180, "vertical drag obeys max height");

    [split setFrameSize:NSMakeSize(701, 420)];
    near(NSWidth(first.frame), 210, "window resize retains dragged leading size");
    near(NSWidth(nested.frame), 124, "window resize retains dragged middle size");
    near(NSHeight(top.frame), 180, "outer resize retains nested drag");
    near(NSMaxY(bottom.frame), 420, "nested split grows with parent");

    [split setFrameSize:NSMakeSize(242, 420)];
    near(NSWidth(first.frame), 75, "compressed first minimum");
    near(NSWidth(nested.frame), 90, "compressed middle minimum");
    near(NSWidth(last.frame), 75, "compressed last minimum");
    [split setFrameSize:NSMakeSize(701, 420)];
    near(NSWidth(first.frame), 210, "growing restores first size");
    near(NSWidth(nested.frame), 124, "growing restores middle size");

    [last removeFromSuperview];
    [split insertArrangedSubview:nested atIndex:0];
    [split configurePanes:{{"nested", 190, 120, 500}, {"first", 170, 100, -1}}
               horizontal:YES dividerStyle:NSSplitViewDividerStyleThick];
    expect(split.dividerStyle == NSSplitViewDividerStyleThick, "native thick style");
    near(NSWidth(nested.frame), 124, "reorder retains size by pane ID");
    near(NSMinX(nested.frame), 0, "rearranged pane starts at origin");
    near(NSMinX(first.frame), 124 + split.dividerThickness, "thick divider changes the gap");

    [split configurePanes:{{"nested", 190, 120, 200}, {"first", 170, 100, 210}}
               horizontal:YES dividerStyle:NSSplitViewDividerStyleThick];
    near(NSWidth(nested.frame), 200, "leading max holds in an oversized container");
    near(NSMaxX(first.frame), 701, "last pane fills excess when every max is exhausted");
    [split setFrameSize:NSMakeSize(1, 420)];
    near(NSMaxX(first.frame), 1, "dividers stay within tiny bounds");
    [split setFrameSize:NSMakeSize(550, 420)];
    [split configurePanes:{{"nested", 190, 120, 200}, {"first", 170, 100, -1}}
               horizontal:NO dividerStyle:NSSplitViewDividerStyleThin];
    near(NSHeight(nested.frame), 190, "orientation change reapplies initial height");
    near(NSWidth(nested.frame), 550, "orientation change switches cross axis");
    near(NSMaxY(first.frame), 420, "vertical split fills available height");

    std::cout << "Native pane split view passed" << std::endl;
  }
}
