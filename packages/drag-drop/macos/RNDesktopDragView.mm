#import "RNDesktopDragView.h"
#import <RNDesktopApp/SparkLocalization.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <react/renderer/components/RNDesktopDragSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDesktopDragSpec/EventEmitters.h>
#import <react/renderer/components/RNDesktopDragSpec/Props.h>
#import <react/renderer/components/RNDesktopDragSpec/RCTComponentViewHelpers.h>
using namespace facebook::react;
static std::string JSON(id value) { NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil]; NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]; return json.UTF8String ?: "{}"; }
static NSDragOperation Operation(NSString *value) { return [value isEqual:@"move"] ? NSDragOperationMove : [value isEqual:@"link"] ? NSDragOperationLink : [value isEqual:@"copy"] ? NSDragOperationCopy : NSDragOperationNone; }
static NSString *OperationName(NSDragOperation value) { return value == NSDragOperationMove ? @"move" : value == NSDragOperationLink ? @"link" : value == NSDragOperationCopy ? @"copy" : @"none"; }
static NSPasteboardType CustomType(NSString *mime) { return [UTType typeWithMIMEType:mime].identifier; }
static NSArray *PasteboardTypes(NSArray *types) {
  NSMutableArray *result = [NSMutableArray new];
  for (NSString *type in types) [result addObject:[type isEqual:@"files"] ? NSPasteboardTypeFileURL : [type isEqual:@"text"] ? NSPasteboardTypeString : [type isEqual:@"urls"] ? NSPasteboardTypeURL : CustomType(type)];
  return result;
}
@implementation RNDesktopDragView {
  NSDictionary *_source;
  NSDictionary *_options;
  BOOL _disabled;
  BOOL _dragging;
  BOOL _mouseDown;
  NSPoint _start;
}
- (instancetype)init { if (self = [super init]) { _props = std::make_shared<const DesktopDragViewProps>(); [self registerForDraggedTypes:@[NSPasteboardTypeFileURL, NSPasteboardTypeURL, NSPasteboardTypeString]]; } return self; }
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<DesktopDragViewProps const>(props);
  NSString *json = [NSString stringWithUTF8String:value.sourceJson.c_str()];
  _source = json.length ? [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  NSString *options = [NSString stringWithUTF8String:value.optionsJson.c_str()];
  _options = options.length ? [NSJSONSerialization JSONObjectWithData:[options dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  [self unregisterDraggedTypes]; [self registerForDraggedTypes:PasteboardTypes(_options[@"acceptedTypes"] ?: @[@"files", @"text", @"urls"])];
  _disabled = value.disabled; [super updateProps:props oldProps:oldProps];
}
- (BOOL)isFlipped { return YES; }
// Fabric parents call the UIKit-compatible overload directly when traversing children.
- (NSView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event { NSView *hit = [super hitTest:point withEvent:event]; return hit && _source.count && !_disabled ? self : hit; }
- (BOOL)mouseDownCanMoveWindow { return _source.count && !_disabled ? NO : [super mouseDownCanMoveWindow]; }
- (NSDragOperation)operation:(id<NSDraggingInfo>)sender {
  if (_disabled || ![sender.draggingPasteboard availableTypeFromArray:PasteboardTypes(_options[@"acceptedTypes"] ?: @[@"files", @"text", @"urls"])]) return NSDragOperationNone;
  for (NSString *name in _options[@"acceptedOperations"] ?: @[@"copy"]) { NSDragOperation operation = Operation(name); if (sender.draggingSourceOperationMask & operation) return operation; }
  return NSDragOperationNone;
}
- (NSDictionary *)position:(id<NSDraggingInfo>)sender {
  NSPoint point = [self convertPoint:sender.draggingLocation fromView:nil];
  return @{ @"x": @(point.x), @"y": @(point.y), @"operation": OperationName([self operation:sender]) };
}
- (NSDictionary *)payload:(id<NSDraggingInfo>)sender {
  NSMutableArray *files = [NSMutableArray new], *urls = [NSMutableArray new]; NSPasteboard *board = sender.draggingPasteboard;
  for (NSURL *url in [board readObjectsForClasses:@[NSURL.class] options:nil]) { if (url.fileURL) [files addObject:url.path]; else [urls addObject:url.absoluteString]; }
  NSMutableDictionary *data = [NSMutableDictionary new];
  for (NSString *type in _options[@"acceptedTypes"]) if ([type containsString:@"/"]) { NSString *value = [board stringForType:CustomType(type)]; if (value) data[type] = value; }
  NSMutableDictionary *result = [[self position:sender] mutableCopy];
  [result addEntriesFromDictionary:@{ @"files": files, @"urls": urls, @"text": [board stringForType:NSPasteboardTypeString] ?: @"", @"data": data }]; return result;
}
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
  NSDragOperation operation = [self operation:sender]; if (!operation) return operation;
  auto emitter = std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); if (emitter) emitter->onDragEnter({ JSON([self payload:sender]) }); return operation;
}
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
  NSDragOperation operation = [self operation:sender];
  auto emitter = std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); if (emitter && operation) emitter->onDragOver({ JSON([self position:sender]) }); return operation;
}
- (void)draggingExited:(id<NSDraggingInfo>)sender { auto emitter = std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); if (emitter) emitter->onDragLeave({ "{}" }); }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender { if (![self operation:sender]) return NO; auto emitter = std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); if (!emitter) return NO; emitter->onDrop({ JSON([self payload:sender]) }); return YES; }
- (void)mouseDown:(NSEvent *)event { _mouseDown = YES; _start = event.locationInWindow; if (!_source.count || _disabled) [super mouseDown:event]; }
- (void)mouseUp:(NSEvent *)event { _mouseDown = NO; [super mouseUp:event]; }
- (void)mouseDragged:(NSEvent *)event {
  if (!_mouseDown || _dragging || _disabled || !_source.count || hypot(event.locationInWindow.x - _start.x, event.locationInWindow.y - _start.y) < 6) { [super mouseDragged:event]; return; }
  NSMutableArray *writers = [NSMutableArray new];
  for (NSString *file in _source[@"files"]) if ([file hasPrefix:@"/"]) [writers addObject:[NSURL fileURLWithPath:file]];
  for (NSString *value in _source[@"urls"]) { NSURL *url = [NSURL URLWithString:value]; if (url) [writers addObject:url]; }
  if (_source[@"text"]) [writers addObject:_source[@"text"]];
  if ([_source[@"data"] count]) {
    NSPasteboardItem *custom = [NSPasteboardItem new];
    for (NSString *type in _source[@"data"]) [custom setString:_source[@"data"][type] forType:CustomType(type)];
    [writers addObject:custom];
  }
  if (!writers.count) return;
  NSMutableArray *items = [NSMutableArray new];
  for (id<NSPasteboardWriting> writer in writers) {
    NSDraggingItem *item = [[NSDraggingItem alloc] initWithPasteboardWriter:writer];
    NSImage *image = [NSImage imageWithSystemSymbolName:@"doc" accessibilityDescription:SparkLocalizedString(@"Dragged item")];
    [item setDraggingFrame:NSMakeRect(0, 0, 32, 32) contents:image]; [items addObject:item];
  }
  _dragging = YES; [self beginDraggingSessionWithItems:items event:event source:self];
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { NSDragOperation mask = NSDragOperationNone; for (NSString *name in _options[@"sourceOperations"] ?: @[@"copy"]) mask |= Operation(name); return mask; }
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
  _dragging = NO; _mouseDown = NO; auto emitter = std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); if (emitter) emitter->onDragEnd({ JSON(@{ @"accepted": @(operation != NSDragOperationNone), @"operation": OperationName(operation) }) });
}
- (void)prepareForRecycle { [super prepareForRecycle]; _source = nil; _options = nil; [self unregisterDraggedTypes]; [self registerForDraggedTypes:PasteboardTypes(@[@"files", @"text", @"urls"])]; _disabled = NO; _dragging = NO; _mouseDown = NO; _start = NSZeroPoint; }
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<DesktopDragViewComponentDescriptor>(); }
@end
