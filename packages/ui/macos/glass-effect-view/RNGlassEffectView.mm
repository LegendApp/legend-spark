#import <AppKit/AppKit.h>
#import <React/RCTConvert.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

@interface SparkGlassView : RCTView
@property (nonatomic, copy) NSString *glassStyle;
@property (nonatomic, strong) NSColor *tintColor;
@end

// Fabric frames React children from the top-left, so their container must be flipped.
@interface SparkGlassContentView : NSView
@end
@implementation SparkGlassContentView
- (BOOL)isFlipped { return YES; }
@end

@implementation SparkGlassView {
  SparkGlassContentView *_contentContainer;
  NSView *_glassEffectView;
}
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _glassStyle = @"regular";
    _contentContainer = [[SparkGlassContentView alloc] initWithFrame:self.bounds];
    _contentContainer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if (@available(macOS 26.0, *)) {
      NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:self.bounds];
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      glass.contentView = _contentContainer;
      _glassEffectView = glass;
      [self addSubview:glass];
    } else {
      [self addSubview:_contentContainer];
    }
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)layout {
  [super layout];
  _contentContainer.frame = self.bounds;
  _glassEffectView.frame = self.bounds;
}
- (void)didUpdateReactSubviews {
  // The glass content view hosts React children in React order; reactSubviews is nil before the first child.
  _contentContainer.subviews = self.reactSubviews ?: @[];
}
- (void)setGlassStyle:(NSString *)style {
  _glassStyle = [style copy];
  if (@available(macOS 26.0, *)) {
    ((NSGlassEffectView *)_glassEffectView).style = [style isEqualToString:@"clear"] ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
  }
}
- (void)setTintColor:(NSColor *)color {
  _tintColor = color;
  if (@available(macOS 26.0, *)) ((NSGlassEffectView *)_glassEffectView).tintColor = color;
}
@end

@interface RNGlassEffectView : RCTViewManager
@end
@implementation RNGlassEffectView
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (NSView *)view { return [[SparkGlassView alloc] initWithFrame:NSZeroRect]; }

RCT_EXPORT_VIEW_PROPERTY(glassStyle, NSString)
// UIColor metadata makes React Native process ColorValue before NSColor conversion.
RCT_CUSTOM_VIEW_PROPERTY(tintColor, UIColor, SparkGlassView)
{
  view.tintColor = json ? [RCTConvert NSColor:json] : nil;
}

@end
