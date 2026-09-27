#import <AppKit/AppKit.h>
#import <React/RCTConvert.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

@interface SparkGlassView : RCTView
@property (nonatomic, copy) NSString *glassStyle;
@property (nonatomic, strong) NSColor *tintColor;
@end

@implementation SparkGlassView {
  NSView *_contentContainer;
  NSView *_glassEffectView;
}
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _glassStyle = @"regular";
    _contentContainer = [[NSView alloc] initWithFrame:self.bounds];
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
- (void)insertReactSubview:(NSView *)subview atIndex:(NSInteger)index {
  [super insertReactSubview:subview atIndex:index];
  [_contentContainer addSubview:subview];
}
- (void)didUpdateReactSubviews {
  // React children are hosted by the native glass content view.
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
