#import "RNSparkTextInput.h"
#import "RNSparkLayoutDirection.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;
// NSTextView has no public placeholder, so an empty view draws its own in the placeholder text color.
@interface RNSparkPlaceholderTextView : NSTextView
@property (nonatomic, copy) NSString *placeholder;
@end
@implementation RNSparkPlaceholderTextView
- (void)setPlaceholder:(NSString *)placeholder { _placeholder = [placeholder copy]; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  if (self.string.length > 0 || _placeholder.length == 0) return;
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = self.alignment;
  paragraph.baseWritingDirection = self.baseWritingDirection;
  CGFloat padding = self.textContainer.lineFragmentPadding;
  NSRect rect = NSInsetRect(self.bounds, self.textContainerInset.width + padding, self.textContainerInset.height);
  [_placeholder drawInRect:rect withAttributes:@{ NSFontAttributeName: self.font ?: [NSFont systemFontOfSize:NSFont.systemFontSize], NSForegroundColorAttributeName: NSColor.placeholderTextColor, NSParagraphStyleAttributeName: paragraph }];
}
- (BOOL)becomeFirstResponder { self.needsDisplay = YES; return [super becomeFirstResponder]; }
@end

@implementation RNSparkTextInput {
  NSTextField *_field;
  NSScrollView *_scrollView;
  RNSparkPlaceholderTextView *_textView;
  NSUndoManager *_undoManager;
  BOOL _initialized;
  BOOL _multiline;
  int _eventCount;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTextInputProps>();
    _field = [NSTextField textFieldWithString:@""];
    _field.delegate = self;
    _field.bezelStyle = NSTextFieldRoundedBezel;
    _field.cell.scrollable = YES;
    _field.cell.wraps = NO;
    _field.cell.usesSingleLineMode = YES;
    _scrollView = [NSScrollView new];
    _scrollView.borderType = NSBezelBorder;
    _scrollView.hasVerticalScroller = YES;
    _scrollView.autohidesScrollers = YES;
    _textView = [[RNSparkPlaceholderTextView alloc] initWithFrame:NSZeroRect];
    _textView.delegate = self;
    _textView.richText = NO;
    _textView.allowsUndo = YES;
    _textView.font = [NSFont systemFontOfSize:NSFont.systemFontSize];
    _textView.textContainerInset = NSMakeSize(2, 4);
    _textView.minSize = NSZeroSize;
    _textView.maxSize = NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX);
    _textView.textContainer.containerSize = NSMakeSize(0, CGFLOAT_MAX);
    _textView.verticallyResizable = YES;
    _textView.horizontallyResizable = NO;
    _textView.autoresizingMask = NSViewWidthSizable;
    _textView.textContainer.widthTracksTextView = YES;
    _textView.automaticQuoteSubstitutionEnabled = NO;
    _textView.automaticDashSubstitutionEnabled = NO;
    _scrollView.documentView = _textView;
    _undoManager = [NSUndoManager new];
    [self addSubview:_field];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (NSString *)currentText { return _multiline ? _textView.string : _field.stringValue; }
- (void)setCurrentText:(NSString *)text {
  // The view keeps its own undo stack, cleared here: typing records hold ranges in the replaced text.
  if (_multiline) { _textView.string = text; [_undoManager removeAllActions]; _textView.needsDisplay = YES; }
  else _field.stringValue = text;
}
- (void)textChanged {
  if (_multiline ? !_textView.editable : !_field.enabled) return;
  ++_eventCount;
  const auto emitter = std::static_pointer_cast<const SparkTextInputEventEmitter>(_eventEmitter);
  if (emitter) emitter->onTextChange({ .text = self.currentText.UTF8String ?: "", .eventCount = _eventCount });
}
- (void)controlTextDidChange:(NSNotification *)notification { [self textChanged]; }
- (void)textDidChange:(NSNotification *)notification { [self textChanged]; }
- (NSUndoManager *)undoManagerForTextView:(NSTextView *)view { return _undoManager; }
// Switching between one line and several keeps the text and swaps the AppKit view.
- (void)setMultiline:(BOOL)multiline {
  if (multiline == _multiline) return;
  NSString *text = self.currentText;
  [_field abortEditing];
  if (_textView.window.firstResponder == _textView) [_textView.window makeFirstResponder:nil];
  _multiline = multiline;
  [(multiline ? (NSView *)_field : _scrollView) removeFromSuperview];
  [self addSubview:multiline ? (NSView *)_scrollView : _field];
  [self setCurrentText:text];
  [self layoutSubviews];
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkTextInputProps>(props);
  [self setMultiline:value.multiline];
  if (!_initialized) { [self setCurrentText:[NSString stringWithUTF8String:value.defaultText.c_str()]]; _initialized = YES; }
  if (value.controlled && value.eventCount >= _eventCount) {
    NSString *text = [NSString stringWithUTF8String:value.text.c_str()];
    if (![self.currentText isEqualToString:text]) [self setCurrentText:text];
  }
  NSString *placeholder = [NSString stringWithUTF8String:value.placeholder.c_str()];
  _field.placeholderString = placeholder.length ? placeholder : nil;
  _textView.placeholder = placeholder;
  _field.enabled = !value.disabled;
  _textView.editable = !value.disabled;
  _textView.textColor = value.disabled ? NSColor.disabledControlTextColor : NSColor.textColor;
  NSView *control = _multiline ? (NSView *)_textView : _field;
  _field.accessibilityIdentifier = _textView.accessibilityIdentifier = nil;
  _field.accessibilityLabel = _textView.accessibilityLabel = nil;
  control.accessibilityIdentifier = [NSString stringWithUTF8String:value.testId.c_str()];
  control.accessibilityLabel = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  _textView.accessibilityPlaceholderValue = placeholder.length ? placeholder : nil;
  [super updateProps:props oldProps:oldProps];
}
- (void)layoutSubviews {
  [super layoutSubviews];
  _field.frame = self.bounds;
  _scrollView.frame = self.bounds;
  _textView.frame = NSMakeRect(0, 0, _scrollView.contentSize.width, MAX(NSHeight(_textView.frame), _scrollView.contentSize.height));
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  NSUserInterfaceLayoutDirection direction = RNSparkLayoutDirection(layoutMetrics);
  _field.alignment = _textView.alignment = RNSparkLeadingTextAlignment(direction);
  _field.userInterfaceLayoutDirection = _textView.userInterfaceLayoutDirection = direction;
  _textView.baseWritingDirection = direction == NSUserInterfaceLayoutDirectionRightToLeft ? NSWritingDirectionRightToLeft : NSWritingDirectionLeftToRight;
  [self layoutSubviews];
}
- (void)prepareForRecycle {
  [_field abortEditing];
  [self setMultiline:NO];
  [super prepareForRecycle];
  _initialized = NO; _eventCount = 0; _field.enabled = YES; _field.stringValue = @""; _field.placeholderString = nil; _field.accessibilityIdentifier = nil; _field.accessibilityLabel = nil;
  _textView.string = @""; [_undoManager removeAllActions]; _textView.placeholder = nil; _textView.editable = YES; _textView.accessibilityIdentifier = nil; _textView.accessibilityLabel = nil;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTextInputComponentDescriptor>(); }
@end
