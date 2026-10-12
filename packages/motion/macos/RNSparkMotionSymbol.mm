#import "RNSparkMotionSymbol.h"
#import "SparkMotionCoordinator.h"
#import <React/RCTConversions.h>
#import <react/renderer/components/RNSparkMotionSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkMotionSpec/Props.h>
using namespace facebook::react;

@interface RNSparkMotionSymbol () <SparkMotionSymbolHost>
@end

static NSString *SparkSymbolString(const std::string &value) { return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()]; }

@implementation RNSparkMotionSymbol {
  NSImageView *_imageView;
  NSInteger _tag;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SparkMotionSymbolComponentDescriptor>();
}

// Effects are addressed by React tag; a recycled view would carry another symbol's effects.
+ (BOOL)shouldBeRecycled { return NO; }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const SparkMotionSymbolProps>();
    _imageView = [NSImageView new];
    _imageView.imageScaling = NSImageScaleNone;  // the symbol configuration sizes it
    _imageView.accessibilityElement = NO;        // the React Native view carries the label and role
    [self addSubview:_imageView];
  }
  return self;
}

- (void)dealloc
{
  NSInteger tag = _tag;
  if (!tag) return;
  if (NSThread.isMainThread) [SparkMotionCoordinator.shared unregisterSymbolTag:tag];
  else dispatch_async(dispatch_get_main_queue(), ^{ [SparkMotionCoordinator.shared unregisterSymbolTag:tag]; });
}

- (NSInteger)motionTag { return _tag; }
- (NSImageView *)symbolImageView { return _imageView; }

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &next = *std::static_pointer_cast<const SparkMotionSymbolProps>(props);
  const auto previous = oldProps ? std::static_pointer_cast<const SparkMotionSymbolProps>(oldProps) : nullptr;
  [super updateProps:props oldProps:oldProps];
  // JavaScript validates the name (it exists on this macOS), the size and the transition.
  _imageView.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:next.size weight:NSFontWeightRegular];
  _imageView.contentTintColor = RCTUIColorFromSharedColor(next.color) ?: NSColor.labelColor;
  if (!previous || previous->name != next.name) {
    NSImage *image = [NSImage imageWithSystemSymbolName:SparkSymbolString(next.name) ?: @"" accessibilityDescription:nil];
    if (_tag) [SparkMotionCoordinator.shared replaceSymbol:self image:image transition:SparkSymbolString(next.replaceTransition)];
    else _imageView.image = image;
  }
  if (_tag) return;
  _tag = self.reactTag.integerValue;
  [SparkMotionCoordinator.shared registerSymbol:self];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _imageView.frame = self.bounds;
  // Directional symbols (arrow.forward) and directional effects (wiggle forward) follow the layout direction.
  _imageView.userInterfaceLayoutDirection = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
}

@end
