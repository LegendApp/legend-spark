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
RCT_CUSTOM_VIEW_PROPERTY(tintColor, NSColor, SparkGlassView)
{
  if (json) {
    NSString *hexString = nil;

    if ([json isKindOfClass:[NSString class]]) {
      hexString = json;
      hexString = [hexString stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      unsigned int colorCode = 0;

      if ([hexString hasPrefix:@"#"]) {
        NSString *colorStr = [hexString substringFromIndex:1];
        NSScanner *scanner = [NSScanner scannerWithString:colorStr];
        [scanner scanHexInt:&colorCode];

        CGFloat red, green, blue, alpha;
        alpha = 1.0;

        if (colorStr.length == 3) {
          red = ((colorCode >> 8) & 0xF) / 15.0;
          green = ((colorCode >> 4) & 0xF) / 15.0;
          blue = (colorCode & 0xF) / 15.0;
        } else if (colorStr.length == 4) {
          red = ((colorCode >> 12) & 0xF) / 15.0;
          green = ((colorCode >> 8) & 0xF) / 15.0;
          blue = ((colorCode >> 4) & 0xF) / 15.0;
          alpha = (colorCode & 0xF) / 15.0;
        } else if (colorStr.length == 6) {
          red = ((colorCode >> 16) & 0xFF) / 255.0;
          green = ((colorCode >> 8) & 0xFF) / 255.0;
          blue = (colorCode & 0xFF) / 255.0;
        } else {
          red = ((colorCode >> 24) & 0xFF) / 255.0;
          green = ((colorCode >> 16) & 0xFF) / 255.0;
          blue = ((colorCode >> 8) & 0xFF) / 255.0;
          alpha = (colorCode & 0xFF) / 255.0;
        }

        view.tintColor = [NSColor colorWithSRGBRed:red green:green blue:blue alpha:alpha];
      }
    } else if ([json isKindOfClass:[NSDictionary class]]) {
      NSDictionary *colorDict = (NSDictionary *)json;
      NSNumber *r = colorDict[@"r"] ?: @0;
      NSNumber *g = colorDict[@"g"] ?: @0;
      NSNumber *b = colorDict[@"b"] ?: @0;
      NSNumber *a = colorDict[@"a"] ?: @1;

      CGFloat red = [r floatValue] / 255.0;
      CGFloat green = [g floatValue] / 255.0;
      CGFloat blue = [b floatValue] / 255.0;
      CGFloat alpha = [a floatValue];

      view.tintColor = [NSColor colorWithSRGBRed:red green:green blue:blue alpha:alpha];
    } else {
      view.tintColor = [RCTConvert NSColor:json];
    }
  } else {
    view.tintColor = nil;
  }
}

@end
