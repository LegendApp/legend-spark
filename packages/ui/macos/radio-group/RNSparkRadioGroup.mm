#import "RNSparkRadioGroup.h"
#import "RNSparkLayoutDirection.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

// NSButton radios in an NSStackView. Radios sharing a superview and action form one AppKit group,
// so a click unchecks the others; the group then reports the value and waits for the app to confirm it.
@implementation RNSparkRadioGroup {
  NSStackView *_stack;
  NSArray<NSString *> *_values;
  NSString *_itemsJson;
  NSString *_value;
  int _selectionRevision;
  NSSize _reportedSize;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkRadioGroupProps>();
    _values = @[];
    _itemsJson = @"";
    _value = @"";
    _stack = [NSStackView new];
    _stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    _stack.alignment = NSLayoutAttributeLeading;
    _stack.spacing = 6;
    _stack.accessibilityRole = NSAccessibilityRadioGroupRole;
    _stack.accessibilityElement = YES;
    [self addSubview:_stack];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (NSArray<NSButton *> *)radios { return (NSArray<NSButton *> *)_stack.arrangedSubviews; }
- (void)reloadItems {
  for (NSView *view in _stack.arrangedSubviews.copy) [view removeFromSuperview];
  NSMutableArray<NSString *> *values = [NSMutableArray new];
  id parsed = [NSJSONSerialization JSONObjectWithData:[_itemsJson dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:nil];
  for (NSDictionary *item in [parsed isKindOfClass:NSArray.class] ? parsed : @[]) {
    if (![item isKindOfClass:NSDictionary.class] || ![item[@"label"] isKindOfClass:NSString.class] || ![item[@"value"] isKindOfClass:NSString.class]) continue;
    NSButton *radio = [NSButton radioButtonWithTitle:item[@"label"] target:self action:@selector(radioClicked:)];
    [_stack addArrangedSubview:radio];
    [values addObject:item[@"value"]];
  }
  _values = values;
}
- (void)applyValue {
  NSArray<NSButton *> *radios = self.radios;
  for (NSUInteger index = 0; index < radios.count; index += 1) radios[index].state = [_values[index] isEqualToString:_value] ? NSControlStateValueOn : NSControlStateValueOff;
}
- (void)radioClicked:(NSButton *)sender {
  NSUInteger index = [self.radios indexOfObjectIdenticalTo:sender];
  if (index == NSNotFound || [_values[index] isEqualToString:_value]) { [self applyValue]; return; }
  auto emitter = std::static_pointer_cast<const SparkRadioGroupEventEmitter>(_eventEmitter);
  if (emitter) emitter->onValueChange({.value = _values[index].UTF8String});
}
- (void)reportIntrinsicSize {
  NSSize size = _stack.fittingSize;
  size = NSMakeSize(ceil(size.width), ceil(size.height));
  auto emitter = std::static_pointer_cast<const SparkRadioGroupEventEmitter>(_eventEmitter);
  if (!emitter || NSEqualSizes(size, _reportedSize)) return;
  _reportedSize = size;
  SparkRadioGroupEventEmitter::OnIntrinsicSize event;
  event.width = size.width;
  event.height = size.height;
  emitter->onIntrinsicSize(event);
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const SparkRadioGroupProps>(props);
  NSString *itemsJson = [NSString stringWithUTF8String:next.itemsJson.c_str()] ?: @"";
  NSString *value = [NSString stringWithUTF8String:next.value.c_str()] ?: @"";
  BOOL reload = ![itemsJson isEqualToString:_itemsJson];
  if (reload) { _itemsJson = itemsJson; [self reloadItems]; }
  if (reload || ![value isEqualToString:_value] || next.selectionRevision != _selectionRevision) {
    _value = value;
    _selectionRevision = next.selectionRevision;
    [self applyValue];
  }
  _stack.orientation = next.orientation == SparkRadioGroupOrientation::Horizontal ? NSUserInterfaceLayoutOrientationHorizontal : NSUserInterfaceLayoutOrientationVertical;
  _stack.alignment = _stack.orientation == NSUserInterfaceLayoutOrientationHorizontal ? NSLayoutAttributeFirstBaseline : NSLayoutAttributeLeading;
  _stack.spacing = _stack.orientation == NSUserInterfaceLayoutOrientationHorizontal ? 16 : 6;
  NSControlSize size = next.controlSize == SparkRadioGroupControlSize::Mini ? NSControlSizeMini : next.controlSize == SparkRadioGroupControlSize::Small ? NSControlSizeSmall : NSControlSizeRegular;
  for (NSButton *radio in self.radios) {
    radio.controlSize = size;
    radio.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:size]];
    radio.enabled = next.enabled;
  }
  NSString *label = [NSString stringWithUTF8String:next.accessibilityLabel.c_str()];
  _stack.accessibilityLabel = label.length ? label : nil;
  _stack.accessibilityIdentifier = [NSString stringWithUTF8String:next.testId.c_str()];
  [super updateProps:props oldProps:oldProps];
  [self reportIntrinsicSize];
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  [self reportIntrinsicSize];
}
- (void)layoutSubviews {
  [super layoutSubviews];
  _stack.frame = self.bounds;
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _stack.userInterfaceLayoutDirection = RNSparkLayoutDirection(layoutMetrics);
  [self layoutSubviews];
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  _itemsJson = @"";
  _value = @"";
  _selectionRevision = 0;
  _reportedSize = NSZeroSize;
  _values = @[];
  for (NSView *view in _stack.arrangedSubviews.copy) [view removeFromSuperview];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkRadioGroupComponentDescriptor>(); }
@end
