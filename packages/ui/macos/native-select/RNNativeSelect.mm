#import "RNNativeSelect.h"

#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
#import <react/renderer/components/RNSparkUISpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface RNNativeSelect () <RCTNativeSelectViewProtocol>
@end

@implementation RNNativeSelect {
#if TARGET_OS_OSX
  NSPopUpButton *_popUpButton;
  NSString *_itemsJson;
  NSString *_value;
  BOOL _isUpdatingSelection;
#else
  UIView *_popUpButton;
#endif
}

- (instancetype)init
{
  if (self = [super init]) {
    _props = std::make_shared<const NativeSelectProps>();
#if TARGET_OS_OSX
    _itemsJson = @"";
    _value = @"";
    _popUpButton = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];
    _popUpButton.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _popUpButton.bordered = YES;
    _popUpButton.controlSize = NSControlSizeRegular;
    _popUpButton.font = [NSFont systemFontOfSize:[NSFont systemFontSize]];
    _popUpButton.target = self;
    _popUpButton.action = @selector(handleSelectionChange:);
    [self addSubview:_popUpButton];
#else
    _popUpButton = [UIView new];
    [self addSubview:_popUpButton];
#endif
  }
  return self;
}

#if TARGET_OS_OSX
- (BOOL)isFlipped
{
  return YES;
}

- (NSArray<NSDictionary *> *)parseItemsJson:(NSString *)itemsJson
{
  NSData *data = [itemsJson dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) {
    return @[];
  }

  id parsedItems = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [parsedItems isKindOfClass:NSArray.class] ? parsedItems : @[];
}

- (void)reloadItems:(NSArray<NSDictionary *> *)items
{
  [_popUpButton removeAllItems];

  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class]) {
      continue;
    }

    NSString *label = [item[@"label"] isKindOfClass:NSString.class] ? item[@"label"] : @"";
    NSString *value = [item[@"value"] isKindOfClass:NSString.class] ? item[@"value"] : label;
    if (label.length == 0 && value.length == 0) {
      continue;
    }

    // addItemWithTitle deduplicates labels; identity belongs to the value.
    NSMenuItem *menuItem = [[NSMenuItem alloc] initWithTitle:label action:nil keyEquivalent:@""];
    menuItem.representedObject = value;
    [_popUpButton.menu addItem:menuItem];
  }
}

- (void)selectValue:(NSString *)value
{
  _isUpdatingSelection = YES;
  NSInteger selectedIndex = -1;
  for (NSInteger index = 0; index < _popUpButton.numberOfItems; index += 1) {
    NSMenuItem *item = [_popUpButton itemAtIndex:index];
    NSString *itemValue = [item.representedObject isKindOfClass:NSString.class] ? item.representedObject : @"";
    if ([itemValue isEqualToString:value]) {
      selectedIndex = index;
      break;
    }
  }

  if (selectedIndex >= 0) {
    [_popUpButton selectItemAtIndex:selectedIndex];
  } else if (_popUpButton.numberOfItems > 0) {
    [_popUpButton selectItemAtIndex:0];
  }
  _isUpdatingSelection = NO;
}

- (void)handleSelectionChange:(id)sender
{
  if (_isUpdatingSelection || !_popUpButton.enabled) {
    return;
  }

  NSMenuItem *selectedItem = _popUpButton.selectedItem;
  NSString *value = [selectedItem.representedObject isKindOfClass:NSString.class] ? selectedItem.representedObject : @"";
  _value = value ?: @"";

  const auto eventEmitter = std::static_pointer_cast<const NativeSelectEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    eventEmitter->onValueChange(NativeSelectEventEmitter::OnValueChange{.value = _value.UTF8String ?: ""});
  }
}
#endif

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<NativeSelectProps const>(props);
#if TARGET_OS_OSX
  NSString *nextItemsJson = [NSString stringWithUTF8String:newProps.itemsJson.c_str()];
  NSString *nextValue = [NSString stringWithUTF8String:newProps.value.c_str()];
  BOOL itemsDidChange = ![_itemsJson isEqualToString:nextItemsJson];

  if (itemsDidChange) {
    _itemsJson = nextItemsJson;
    [self reloadItems:[self parseItemsJson:_itemsJson]];
  }

  if (itemsDidChange || ![_value isEqualToString:nextValue]) {
    _value = nextValue;
    [self selectValue:_value];
  }

  _popUpButton.enabled = newProps.enabled;
  _popUpButton.accessibilityLabel = [NSString stringWithUTF8String:newProps.accessibilityLabel.c_str()];
  _popUpButton.accessibilityIdentifier = [NSString stringWithUTF8String:newProps.testId.c_str()];
#endif
  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
#if TARGET_OS_OSX
  _itemsJson = @"";
  _value = @"";
  _isUpdatingSelection = NO;
  [_popUpButton removeAllItems];
  _popUpButton.enabled = YES;
  _popUpButton.accessibilityLabel = nil; _popUpButton.accessibilityIdentifier = nil;
#endif
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _popUpButton.frame = self.bounds;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self layoutSubviews];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NativeSelectComponentDescriptor>();
}

@end
