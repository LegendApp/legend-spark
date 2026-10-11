#import "RNSparkPrimitive.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

// AppKit's default keyboard/AX increment can be smaller than the configured step,
// which would otherwise round back to the same value in the change handler.
@interface RNSparkPrimitiveSlider : NSSlider
@property double sparkStep;
@property BOOL sparkStepping;
@end
@implementation RNSparkPrimitiveSlider
- (BOOL)moveBy:(double)delta {
  if (!self.enabled) return NO;
  double value = fmin(self.maxValue, fmax(self.minValue, self.doubleValue + delta));
  if (value != self.doubleValue) {
    self.doubleValue = value;
    self.sparkStepping = YES;
    [self sendAction:self.action to:self.target];
    self.sparkStepping = NO;
  }
  return YES;
}
- (BOOL)accessibilityPerformIncrement { return [self moveBy:self.sparkStep]; }
- (BOOL)accessibilityPerformDecrement { return [self moveBy:-self.sparkStep]; }
- (void)keyDown:(NSEvent *)event {
  NSString *characters = event.charactersIgnoringModifiers;
  if (characters.length && !(event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl))) {
    unichar key = [characters characterAtIndex:0];
    BOOL rtl = self.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
    if (key == NSUpArrowFunctionKey || key == NSRightArrowFunctionKey || key == NSDownArrowFunctionKey || key == NSLeftArrowFunctionKey) {
      BOOL increase = key == NSUpArrowFunctionKey || (key == NSRightArrowFunctionKey && !rtl) || (key == NSLeftArrowFunctionKey && rtl);
      [self moveBy:increase ? self.sparkStep : -self.sparkStep];
      return;
    }
  }
  [super keyDown:event];
}
@end

@implementation RNSparkPrimitive {
  NSView *_control;
  NSString *_kind;
  NSDictionary *_payload;
  NSString *_lastJSON;
  NSString *_pendingError;
  // Events this view has emitted, and the latest count JS has echoed back through props.
  int _eventCount;
  int _acknowledged;
  BOOL _disabled;
  BOOL _updating;
  BOOL _rtl;
}
- (instancetype)init {
  if (self = [super init]) _props = std::make_shared<const SparkPrimitiveProps>();
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)discardControl {
  if ([_control isKindOfClass:NSTextField.class]) {
    [(NSTextField *)_control abortEditing];
    [(NSTextField *)_control setDelegate:nil];
  }
  if ([_control isKindOfClass:NSProgressIndicator.class]) [(NSProgressIndicator *)_control stopAnimation:nil];
  if ([self.window.firstResponder isKindOfClass:NSView.class] && [(NSView *)self.window.firstResponder isDescendantOf:_control]) [self.window makeFirstResponder:nil];
  [_control removeFromSuperview];
  _control = nil;
}
- (void)createControl:(NSString *)kind {
  [self discardControl];
  _kind = kind;
  if ([kind isEqual:@"checkbox"] || [kind isEqual:@"disclosure-triangle"]) {
    NSButton *button = [NSButton buttonWithTitle:@"" target:self action:@selector(changed:)];
    button.buttonType = [kind isEqual:@"checkbox"] ? NSButtonTypeSwitch : NSButtonTypeOnOff;
    if ([kind isEqual:@"disclosure-triangle"]) button.bezelStyle = NSBezelStyleDisclosure;
    _control = button;
  } else if ([kind isEqual:@"radio-group"]) {
    _control = [NSView new];
    _control.accessibilityRole = NSAccessibilityRadioGroupRole;
    _control.accessibilityElement = YES;
  } else if ([kind isEqual:@"switch"]) {
    NSSwitch *toggle = [NSSwitch new]; toggle.target = self; toggle.action = @selector(changed:); _control = toggle;
  } else if ([kind isEqual:@"slider"]) {
    RNSparkPrimitiveSlider *slider = [RNSparkPrimitiveSlider new]; slider.target = self; slider.action = @selector(changed:); _control = slider;
  } else if ([kind isEqual:@"stepper"]) {
    NSStepper *stepper = [NSStepper new]; stepper.target = self; stepper.action = @selector(changed:); stepper.valueWraps = NO; _control = stepper;
  } else if ([kind isEqual:@"combo-box"]) {
    NSComboBox *combo = [NSComboBox new]; combo.delegate = self; combo.completes = YES; _control = combo;
  } else if ([kind isEqual:@"token-field"]) {
    NSTokenField *tokens = [NSTokenField new]; tokens.delegate = self; _control = tokens;
  } else if ([kind isEqual:@"path-control"]) {
    NSPathControl *path = [NSPathControl new]; path.target = self; path.action = @selector(changed:); _control = path;
  } else if ([kind isEqual:@"progress"]) {
    _control = [NSProgressIndicator new];
  } else if ([kind isEqual:@"level-indicator"]) {
    NSLevelIndicator *level = [NSLevelIndicator new]; level.levelIndicatorStyle = NSLevelIndicatorStyleContinuousCapacity; _control = level;
  }
  if (_control) [self addSubview:_control];
}
- (void)reportError:(NSString *)message {
  const auto emitter = std::static_pointer_cast<const SparkPrimitiveEventEmitter>(_eventEmitter);
  if (emitter) emitter->onNativeError({ .message = message.UTF8String, .eventCount = _eventCount });
  else _pendingError = message;
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  NSString *pending = _pendingError;
  _pendingError = nil;
  if (pending) [self reportError:pending];
}
// Every emitted value or failure is counted, so a value JS never accepts is restored once JS echoes the count.
- (void)emitValue:(id)value {
  const auto emitter = std::static_pointer_cast<const SparkPrimitiveEventEmitter>(_eventEmitter);
  if (_disabled || _updating || !value || !emitter) return;
  ++_eventCount;
  NSError *error;
  // isValidJSONObject requires a container; wrapping validates the fragment (NaN, infinities, non-string keys).
  NSData *data = [NSJSONSerialization isValidJSONObject:@[value]] ? [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:&error] : nil;
  NSString *json = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (json) emitter->onValueChange({ .valueJson = json.UTF8String, .eventCount = _eventCount });
  else [self reportError:[NSString stringWithFormat:@"Native %@ value cannot be serialized as JSON: %@", _kind, error.localizedDescription ?: [value description]]];
}
- (void)changed:(id)sender {
  if (_disabled || _updating) return;
  if ([_kind isEqual:@"checkbox"]) {
    NSControlStateValue state = [(NSButton *)sender state];
    [self emitValue:state == NSControlStateValueMixed ? @"mixed" : @(state == NSControlStateValueOn)];
  } else if ([_kind isEqual:@"switch"] || [_kind isEqual:@"disclosure-triangle"]) {
    [self emitValue:@([sender state] == NSControlStateValueOn)];
  } else if ([_kind isEqual:@"radio-group"]) {
    for (NSButton *button in _control.subviews) button.state = button == sender ? NSControlStateValueOn : NSControlStateValueOff;
    [self emitValue:_payload[@"options"][[sender tag]][@"value"]];
  } else if ([_kind isEqual:@"slider"] || [_kind isEqual:@"stepper"]) {
    double value = [sender doubleValue], minimum = [_payload[@"min"] doubleValue], maximum = [_payload[@"max"] doubleValue], step = [_payload[@"step"] doubleValue];
    if ([_kind isEqual:@"slider"] && ![(RNSparkPrimitiveSlider *)sender sparkStepping] && step > 0) value = minimum + round((value - minimum) / step) * step;
    value = fmin(maximum, fmax(minimum, value));
    [sender setDoubleValue:value];
    [self emitValue:@(value)];
  } else if ([_kind isEqual:@"path-control"]) {
    NSPathControl *path = (NSPathControl *)_control;
    NSURL *url = path.clickedPathItem.URL ?: path.URL;
    [self emitValue:url.absoluteString];
  }
}
- (void)controlTextDidChange:(NSNotification *)notification {
  if ([_kind isEqual:@"combo-box"]) [self emitValue:[(NSComboBox *)_control stringValue]];
}
- (void)controlTextDidEndEditing:(NSNotification *)notification {
  if ([_kind isEqual:@"token-field"]) [self emitValue:[(NSTokenField *)_control objectValue] ?: @[]];
}
- (void)comboBoxSelectionDidChange:(NSNotification *)notification {
  NSComboBox *combo = (NSComboBox *)_control;
  [self emitValue:combo.objectValueOfSelectedItem ?: combo.stringValue];
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkPrimitiveProps>(props);
  NSString *kind = [NSString stringWithUTF8String:value.kind.c_str()];
  NSString *json = [NSString stringWithUTF8String:value.valueJson.c_str()];
  NSError *error;
  id parsed = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:&error];
  NSDictionary *payload = [parsed isKindOfClass:NSDictionary.class] ? parsed : nil;
  BOOL recreated = ![_kind isEqual:kind] || !_control;
  // Keep the last valid configuration on screen rather than blanking the control.
  if (!payload) {
    [self reportError:[NSString stringWithFormat:@"Invalid %@ configuration JSON: %@", kind, error.localizedDescription ?: @"expected an object"]];
    if (!recreated) { payload = _payload; json = _lastJSON; }
  }
  _updating = YES;
  if (recreated) [self createControl:kind];
  // Reconcile only once JS has processed every native event, so stale props never overwrite an edit in flight.
  BOOL reconcile = recreated || (value.eventCount >= _eventCount && (![_lastJSON isEqual:json] || value.eventCount != _acknowledged));
  NSDictionary *previous = _payload;
  _payload = payload; _lastJSON = json; _acknowledged = value.eventCount; _disabled = value.disabled;
  NSString *label = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  NSString *identifier = [NSString stringWithUTF8String:value.testId.c_str()];
  NSControlSize size = value.controlSize == "mini" ? NSControlSizeMini : value.controlSize == "small" ? NSControlSizeSmall : value.controlSize == "large" ? NSControlSizeLarge : NSControlSizeRegular;
  _control.accessibilityLabel = label; _control.accessibilityIdentifier = identifier;
  if ([_control isKindOfClass:NSControl.class]) {
    NSControl *control = (NSControl *)_control;
    control.enabled = !_disabled; control.controlSize = size; control.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:size]];
  }
  if (!payload) {
    // A new control with invalid configuration has nothing valid to show; the failure was reported above.
  } else if ([kind isEqual:@"radio-group"]) {
    NSArray *options = payload[@"options"];
    if (recreated || ![options isEqual:previous[@"options"]]) {
      for (NSView *child in [_control.subviews copy]) [child removeFromSuperview];
      [options enumerateObjectsUsingBlock:^(NSDictionary *option, NSUInteger index, BOOL *stop) {
        NSButton *radio = [NSButton radioButtonWithTitle:option[@"label"] target:self action:@selector(changed:)];
        radio.tag = index; [_control addSubview:radio];
      }];
    }
    for (NSButton *radio in _control.subviews) {
      radio.enabled = !_disabled; radio.controlSize = size; radio.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:size]];
      radio.accessibilityLabel = options[radio.tag][@"label"];
      radio.accessibilityIdentifier = [NSString stringWithFormat:@"%@.%@", identifier, options[radio.tag][@"value"]];
      if (reconcile) radio.state = [options[radio.tag][@"value"] isEqual:payload[@"value"]] ? NSControlStateValueOn : NSControlStateValueOff;
    }
  } else if ([kind isEqual:@"checkbox"] || [kind isEqual:@"disclosure-triangle"]) {
    NSButton *button = (NSButton *)_control;
    button.title = payload[@"label"] ?: @"";
    button.allowsMixedState = [kind isEqual:@"checkbox"] && [payload[@"value"] isEqual:@"mixed"];
    if (reconcile) button.state = [payload[@"value"] isEqual:@"mixed"] ? NSControlStateValueMixed : [payload[@"value"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
  } else if ([kind isEqual:@"switch"]) {
    if (reconcile) [(NSSwitch *)_control setState:[payload[@"value"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff];
  } else if ([kind isEqual:@"slider"]) {
    RNSparkPrimitiveSlider *slider = (RNSparkPrimitiveSlider *)_control;
    slider.sparkStep = [payload[@"step"] doubleValue];
    slider.minValue = [payload[@"min"] doubleValue]; slider.maxValue = [payload[@"max"] doubleValue];
    slider.numberOfTickMarks = [payload[@"ticks"] integerValue]; slider.continuous = [payload[@"continuous"] boolValue];
    if (reconcile && slider.doubleValue != [payload[@"value"] doubleValue]) slider.doubleValue = [payload[@"value"] doubleValue];
  } else if ([kind isEqual:@"stepper"]) {
    NSStepper *stepper = (NSStepper *)_control;
    stepper.minValue = [payload[@"min"] doubleValue]; stepper.maxValue = [payload[@"max"] doubleValue]; stepper.increment = [payload[@"step"] doubleValue];
    if (reconcile) stepper.doubleValue = [payload[@"value"] doubleValue];
  } else if ([kind isEqual:@"combo-box"]) {
    NSComboBox *combo = (NSComboBox *)_control;
    if (recreated || ![payload[@"options"] isEqual:previous[@"options"]]) { [combo removeAllItems]; [combo addItemsWithObjectValues:payload[@"options"]]; }
    if (reconcile && ![combo.stringValue isEqual:payload[@"value"]]) combo.stringValue = payload[@"value"];
  } else if ([kind isEqual:@"token-field"]) {
    NSTokenField *tokens = (NSTokenField *)_control;
    if (reconcile && ![tokens.objectValue isEqual:payload[@"value"]]) tokens.objectValue = payload[@"value"];
  } else if ([kind isEqual:@"path-control"]) {
    NSPathControl *path = (NSPathControl *)_control;
    NSURL *url = [NSURL URLWithString:payload[@"value"]];
    if (reconcile && ![path.URL isEqual:url]) path.URL = url;
  } else if ([kind isEqual:@"progress"]) {
    NSProgressIndicator *progress = (NSProgressIndicator *)_control;
    progress.controlSize = size;
    progress.style = [payload[@"mode"] isEqual:@"spinner"] ? NSProgressIndicatorStyleSpinning : NSProgressIndicatorStyleBar;
    progress.indeterminate = ![payload[@"mode"] isEqual:@"determinate"];
    progress.minValue = 0; progress.maxValue = 1; progress.doubleValue = [payload[@"value"] doubleValue];
    // Disabling a read-only indicator does not stop the work it reports.
    if (progress.indeterminate) [progress startAnimation:nil]; else [progress stopAnimation:nil];
  } else if ([kind isEqual:@"level-indicator"]) {
    NSLevelIndicator *level = (NSLevelIndicator *)_control;
    level.minValue = [payload[@"min"] doubleValue]; level.maxValue = [payload[@"max"] doubleValue]; level.doubleValue = [payload[@"value"] doubleValue];
  }
  _updating = NO;
  [super updateProps:props oldProps:oldProps];
  [self layoutSubviews];
}
- (void)layoutSubviews {
  [super layoutSubviews];
  _control.frame = self.bounds;
  _control.userInterfaceLayoutDirection = _rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
  if ([_kind isEqual:@"checkbox"]) {
    NSButton *button = (NSButton *)_control;
    button.alignment = _rtl ? NSTextAlignmentRight : NSTextAlignmentLeft;
    button.imagePosition = _rtl ? NSImageRight : NSImageLeft;
  }
  if ([_control isKindOfClass:NSSwitch.class] || [_control isKindOfClass:NSStepper.class] ||
      ([_control isKindOfClass:NSProgressIndicator.class] && [(NSProgressIndicator *)_control style] == NSProgressIndicatorStyleSpinning)) {
    [(id)_control sizeToFit];
    NSSize size = _control.frame.size;
    _control.frame = NSMakeRect(_rtl ? NSWidth(self.bounds) - size.width : 0, (NSHeight(self.bounds) - size.height) / 2, size.width, size.height);
  }
  if ([_kind isEqual:@"radio-group"]) {
    CGFloat x = _rtl ? NSWidth(self.bounds) : 0;
    for (NSButton *radio in _control.subviews) {
      radio.userInterfaceLayoutDirection = _control.userInterfaceLayoutDirection;
      radio.imagePosition = _rtl ? NSImageRight : NSImageLeft;
      [radio sizeToFit]; NSRect frame = radio.frame;
      if (_rtl) x -= NSWidth(frame);
      frame.origin = NSMakePoint(x, (NSHeight(self.bounds) - NSHeight(frame)) / 2); radio.frame = frame;
      x += _rtl ? -12 : NSWidth(frame) + 12;
    }
  }
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  _rtl = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics]; [self layoutSubviews];
}
- (void)prepareForRecycle {
  _updating = YES; [self discardControl];
  _kind = nil; _payload = nil; _lastJSON = nil; _pendingError = nil; _eventCount = 0; _acknowledged = 0; _disabled = NO; _updating = NO;
  [super prepareForRecycle];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkPrimitiveComponentDescriptor>(); }
@end
