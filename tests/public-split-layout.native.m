// Public AppKit layout minimizer. Never orders a window or activates the app.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
// SDK_CLASSES

@interface PublicLayoutProbeApplication : NSApplication
@end
@implementation PublicLayoutProbeApplication
- (void)reportException:(NSException *)exception {
  fprintf(stderr, "APPKIT EXCEPTION: %s: %s\n", exception.name.UTF8String, exception.reason.UTF8String);
  exit(1);
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [PublicLayoutProbeApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    if (@available(macOS 26.0, *)) {
      NSString *mode = argc > 1 ? @(argv[1]) : @"owned-before";
      BOOL embedded = [mode hasPrefix:@"embedded"];
      BOOL late = [mode hasSuffix:@"after"];
      BOOL zero = [mode containsString:@"zero"];
      BOOL premount = [mode containsString:@"premount"];
      BOOL sdk = [mode containsString:@"sdk"];
      @try {
        NSSplitViewController *split = [NSSplitViewController new];
        if ([mode containsString:@"replacement-stock"]) split.splitView = [NSSplitView new];
#ifdef SDK_SPLIT_PROBE
        if (sdk && ![mode containsString:@"pane-only"]) split.splitView = [RNSidebarSplitViewNativeSplitView new];
#else
        if (sdk) return 78;
#endif
        if ([mode containsString:@"no-autoresizing"]) split.splitView.translatesAutoresizingMaskIntoConstraints = NO;
        split.splitView.vertical = YES;
        split.minimumThicknessForInlineSidebars = 0;
        NSViewController *side = [NSViewController new];
        NSViewController *body = [NSViewController new];
        side.view = [[NSView alloc] initWithFrame:zero ? NSZeroRect : NSMakeRect(0, 0, 200, 752)];
        body.view = [[NSView alloc] initWithFrame:zero ? NSZeroRect : NSMakeRect(0, 0, 800, 752)];
#ifdef SDK_SPLIT_PROBE
        if (sdk && ![mode containsString:@"split-only"]) {
          NSView *pane = [[RNSidebarSplitViewPaneView alloc] initWithFrame:body.view.frame];
          pane.wantsLayer = YES;
          pane.layer.masksToBounds = NO;
          NSView *host = [RNSidebarSplitViewPaneHost new];
          host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
          [pane addSubview:host];
          body.view = pane;
        }
#endif
        NSSplitViewItem *sidebar = [NSSplitViewItem sidebarWithViewController:side];
        NSSplitViewItem *content = [NSSplitViewItem splitViewItemWithViewController:body];
        sidebar.minimumThickness = 180;
        content.minimumThickness = 400;
        sidebar.allowsFullHeightLayout = YES;
        content.allowsFullHeightLayout = YES;
        if (!late) content.automaticallyAdjustsSafeAreaInsets = YES;
        [split addSplitViewItem:sidebar];
        [split addSplitViewItem:content];
        if (premount) [split.view layoutSubtreeIfNeeded];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 752)
          styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
          backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO;
        window.toolbar = [[NSToolbar alloc] initWithIdentifier:@"public-layout-probe"];
        window.toolbarStyle = NSWindowToolbarStyleUnified;
        window.titlebarAppearsTransparent = YES;
        if (embedded) {
          split.view.frame = window.contentView.bounds;
          split.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
          [window.contentView addSubview:split.view];
        } else {
          window.contentViewController = split;
        }
        [window.contentView.superview layoutSubtreeIfNeeded];
        if (late) {
          content.automaticallyAdjustsSafeAreaInsets = YES;
          [window.contentView.superview layoutSubtreeIfNeeded];
        }
        printf("PASS %s: sidebar=%s content=%s\n", mode.UTF8String,
          NSStringFromRect(side.view.frame).UTF8String, NSStringFromRect(body.view.frame).UTF8String);
        [window close];
      } @catch (NSException *exception) {
        fprintf(stderr, "FAIL %s: %s: %s\n", mode.UTF8String, exception.name.UTF8String, exception.reason.UTF8String);
        return 1;
      }
    } else {
      fprintf(stderr, "macOS 26+ required\n");
      return 77;
    }
  }
  return 0;
}
