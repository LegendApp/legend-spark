#import "RNDesktopDragView.h"
#import "SparkDragSession.h"
#import <RNDesktopApp/SparkLocalization.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import <react/renderer/components/RNDesktopDragSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDesktopDragSpec/EventEmitters.h>
#import <react/renderer/components/RNDesktopDragSpec/Props.h>
#import <react/renderer/components/RNDesktopDragSpec/RCTComponentViewHelpers.h>
using namespace facebook::react;
static std::string JSON(id value) { NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil]; NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]; return json.UTF8String ?: "{}"; }
static NSArray *const DefaultTypes = @[@"files", @"text", @"urls"];
// How long a promised file may take to be written before the destination gets an error (E_TIMEOUT).
static const NSTimeInterval PromisedFileTimeout = 60;
@interface RNDesktopDragView () <NSSpringLoadingDestination, RCTDesktopDragViewViewProtocol>
- (NSArray<NSDraggingItem *> *)draggingItemsAt:(NSPoint)location;
- (NSDragOperation)sourceMask:(BOOL)outside;
- (BOOL)canStartDrag;
- (BOOL)ignoresModifierKeys;
@end
@implementation RNDesktopDragView {
  NSDictionary *_source;
  NSDictionary *_options;
  BOOL _disabled;
  BOOL _dragging;
  BOOL _mouseDown;
  NSPoint _start;
  SparkPromisedFiles *_promises;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const DesktopDragViewProps>();
    [self registerForDraggedTypes:SparkDragPasteboardTypes(DefaultTypes)];
    __weak RNDesktopDragView *weakSelf = self;
    _promises = [[SparkPromisedFiles alloc] initWithTimeout:PromisedFileTimeout request:^(NSInteger requestId, NSString *name, NSString *path) {
      auto emitter = [weakSelf emitter];
      if (emitter) emitter->onPromisedFileWrite({ JSON(@{ @"id": @(requestId), @"name": name, @"path": path }) });
      else [weakSelf.promises complete:requestId error:@"The drag source is not mounted"];
    } failure:^(NSString *code, NSString *message) { [weakSelf fail:code message:message]; }];
  }
  return self;
}
- (SparkPromisedFiles *)promises { return _promises; }
- (std::shared_ptr<const DesktopDragViewEventEmitter>)emitter { return std::static_pointer_cast<const DesktopDragViewEventEmitter>(_eventEmitter); }
- (void)fail:(NSString *)code message:(NSString *)message { auto emitter = [self emitter]; if (emitter) emitter->onError({ JSON(@{ @"message": message, @"unavailable": @NO, @"code": code }) }); }
- (NSArray *)acceptedTypes { return _options[@"acceptedTypes"] ?: DefaultTypes; }
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<DesktopDragViewProps const>(props);
  NSString *json = [NSString stringWithUTF8String:value.sourceJson.c_str()];
  _source = json.length ? [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  NSString *options = [NSString stringWithUTF8String:value.optionsJson.c_str()];
  _options = options.length ? [NSJSONSerialization JSONObjectWithData:[options dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
  [self unregisterDraggedTypes]; [self registerForDraggedTypes:SparkDragPasteboardTypes([self acceptedTypes])];
  _disabled = value.disabled; [super updateProps:props oldProps:oldProps];
}
- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args { RCTDesktopDragViewHandleCommand(self, commandName, args); }
// The app's answer to onPromisedFileWrite: an empty error when the file is written.
- (void)completePromisedFile:(NSInteger)requestId error:(NSString *)error { [_promises complete:requestId error:error]; }
- (BOOL)isFlipped { return YES; }
// Fabric parents call the UIKit-compatible overload directly when traversing children.
- (NSView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event { NSView *hit = [super hitTest:point withEvent:event]; return hit && _source.count && !_disabled ? self : hit; }
- (BOOL)mouseDownCanMoveWindow { return _source.count && !_disabled ? NO : [super mouseDownCanMoveWindow]; }

#pragma mark Destination
- (NSDragOperation)operation:(id<NSDraggingInfo>)sender {
  if (_disabled || ![sender.draggingPasteboard availableTypeFromArray:SparkDragPasteboardTypes([self acceptedTypes])]) return NSDragOperationNone;
  return SparkDragResolve(sender.draggingSourceOperationMask, _options[@"acceptedOperations"] ?: @[@"copy"]);
}
- (NSDictionary *)position:(id<NSDraggingInfo>)sender {
  NSPoint point = [self convertPoint:sender.draggingLocation fromView:nil];
  return @{ @"x": @(point.x), @"y": @(point.y), @"operation": SparkDragOperationName([self operation:sender]), @"allowedOperations": SparkDragAllowedOperations(sender.draggingSourceOperationMask) };
}
- (NSDictionary *)payload:(id<NSDraggingInfo>)sender {
  NSMutableArray *files = [NSMutableArray new], *urls = [NSMutableArray new]; NSPasteboard *board = sender.draggingPasteboard;
  for (NSURL *url in [board readObjectsForClasses:@[NSURL.class] options:nil]) { if (url.fileURL) [files addObject:url.path]; else [urls addObject:url.absoluteString]; }
  NSMutableDictionary *data = [NSMutableDictionary new];
  for (NSString *type in _options[@"acceptedTypes"]) if ([type containsString:@"/"]) { NSString *value = [board stringForType:SparkDragCustomType(type)]; if (value) data[type] = value; }
  NSMutableDictionary *result = [[self position:sender] mutableCopy];
  [result addEntriesFromDictionary:@{ @"files": files, @"urls": urls, @"text": [board stringForType:NSPasteboardTypeString] ?: @"", @"data": data }]; return result;
}
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
  NSDragOperation operation = [self operation:sender]; if (!operation) return operation;
  auto emitter = [self emitter]; if (emitter) emitter->onDragEnter({ JSON([self payload:sender]) }); return operation;
}
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
  NSDragOperation operation = [self operation:sender];
  auto emitter = [self emitter]; if (emitter && operation) emitter->onDragOver({ JSON([self position:sender]) }); return operation;
}
- (void)draggingExited:(id<NSDraggingInfo>)sender { auto emitter = [self emitter]; if (emitter) emitter->onDragLeave({ "{}" }); }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender { if (![self operation:sender]) return NO; auto emitter = [self emitter]; if (!emitter) return NO; emitter->onDrop({ JSON([self payload:sender]) }); return YES; }

#pragma mark Spring loading
- (NSSpringLoadingOptions)springLoadingOptions:(id<NSDraggingInfo>)sender {
  BOOL enabled = !_disabled && [_options[@"springLoading"] boolValue] && [sender.draggingPasteboard availableTypeFromArray:SparkDragPasteboardTypes([self acceptedTypes])];
  return enabled ? NSSpringLoadingEnabled : NSSpringLoadingDisabled;
}
- (NSSpringLoadingOptions)springLoadingEntered:(id<NSDraggingInfo>)sender { return [self springLoadingOptions:sender]; }
- (NSSpringLoadingOptions)springLoadingUpdated:(id<NSDraggingInfo>)sender { return [self springLoadingOptions:sender]; }
- (void)springLoadingActivated:(BOOL)activated draggingInfo:(id<NSDraggingInfo>)sender { auto emitter = [self emitter]; if (emitter && activated) emitter->onSpringLoad({ "{}" }); }
- (void)springLoadingHighlightChanged:(id<NSDraggingInfo>)sender {
  NSSpringLoadingHighlight highlight = sender.springLoadingHighlight;
  auto emitter = [self emitter];
  if (emitter) emitter->onSpringLoadHighlight({ JSON(@{ @"highlight": highlight == NSSpringLoadingHighlightEmphasized ? @"emphasized" : highlight == NSSpringLoadingHighlightStandard ? @"standard" : @"none" }) });
}

#pragma mark Source
- (NSArray<NSDraggingItem *> *)draggingItemsAt:(NSPoint)location {
  NSError *error = nil;
  NSArray *items = SparkDragItems(_source, _options[@"dragImage"], self, location, SparkLocalizedString(@"Dragged item"), _promises, &error);
  if (!items) [self fail:error.userInfo[@"code"] message:error.localizedDescription];
  return items;
}
- (NSDragOperation)sourceMask:(BOOL)outside { return SparkDragSourceMask(_options[outside ? @"externalOperations" : @"sourceOperations"] ?: @[@"copy"]); }
- (void)mouseDown:(NSEvent *)event { _mouseDown = YES; _start = event.locationInWindow; if (!_source.count || _disabled) [super mouseDown:event]; }
- (void)mouseUp:(NSEvent *)event { _mouseDown = NO; [super mouseUp:event]; }
- (void)mouseDragged:(NSEvent *)event {
  if (!_mouseDown || _dragging || _disabled || !_source.count || hypot(event.locationInWindow.x - _start.x, event.locationInWindow.y - _start.y) < 6) { [super mouseDragged:event]; return; }
  _mouseDown = NO;
  // A window server drag follows the real pointer: driven apps drag through the testDrag driver command instead.
  if (SparkTestDriverActive()) { [self fail:@"E_UNAVAILABLE" message:@"A driven app drags through the test driver, never the window server"]; return; }
  NSArray *items = [self draggingItemsAt:[self convertPoint:_start fromView:nil]];
  if (!items) return;
  _dragging = YES; [self beginDraggingSessionWithItems:items event:event source:self];
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { return [self sourceMask:context == NSDraggingContextOutsideApplication]; }
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session { return [_options[@"ignoreModifierKeys"] boolValue]; }
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
  _dragging = NO; _mouseDown = NO; auto emitter = [self emitter];
  if (emitter) emitter->onDragEnd({ JSON(@{ @"accepted": @(operation != NSDragOperationNone), @"operation": SparkDragOperationName(operation) }) });
}
- (void)prepareForRecycle {
  [super prepareForRecycle]; [_promises cancelAll]; _source = nil; _options = nil; [self unregisterDraggedTypes]; [self registerForDraggedTypes:SparkDragPasteboardTypes(DefaultTypes)];
  _disabled = NO; _dragging = NO; _mouseDown = NO; _start = NSZeroPoint;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<DesktopDragViewComponentDescriptor>(); }
- (BOOL)canStartDrag { return _source.count && !_disabled; }
- (BOOL)ignoresModifierKeys { return [_options[@"ignoreModifierKeys"] boolValue]; }
@end

#if SPARK_TEST_DRIVER
#pragma mark Test driver
// testDrag runs a drag between Spark drag views in process, as the window server would (docs/drag-drop.md#testing):
// {phase: begin, from, modifiers?} starts one from the source view containing `from`; {phase: move, to, modifiers?} moves
// over the drag view containing `to` (null: over nothing); {phase: drop | cancel} ends it; {phase: dropInFolder, folder}
// drops it in a folder as Finder would, writing its promised files there. The folder must be in a temporary directory.
static SparkSimulatedDrag *testDrag;
static NSDictionary *DriverFailure(NSString *code, NSString *message) { return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } }; }
static RNDesktopDragView *DragViewContaining(NSString *testID) {
  for (NSView *view = SparkTestDriverFindView(testID); view; view = view.superview) if ([view isKindOfClass:RNDesktopDragView.class]) return (RNDesktopDragView *)view;
  return nil;
}
static BOOL Modifiers(id names, NSEventModifierFlags *flags) {
  NSDictionary *bits = @{ @"cmd": @(NSEventModifierFlagCommand), @"ctrl": @(NSEventModifierFlagControl), @"option": @(NSEventModifierFlagOption), @"shift": @(NSEventModifierFlagShift), @"fn": @(NSEventModifierFlagFunction) };
  *flags = 0;
  if (!names) return YES;
  if (![names isKindOfClass:NSArray.class]) return NO;
  for (id name in names) { NSNumber *bit = [name isKindOfClass:NSString.class] ? bits[name] : nil; if (!bit) return NO; *flags |= bit.unsignedIntegerValue; }
  return YES;
}
static BOOL TemporaryFolder(NSString *folder) {
  BOOL directory = NO;
  if (![folder isKindOfClass:NSString.class] || !folder.isAbsolutePath || ![NSFileManager.defaultManager fileExistsAtPath:folder isDirectory:&directory] || !directory) return NO;
  NSString *resolved = folder.stringByResolvingSymlinksInPath.stringByStandardizingPath;
  for (NSString *root in @[NSTemporaryDirectory(), @"/private/var/folders/", @"/private/tmp/"])
    if ([[resolved stringByAppendingString:@"/"] hasPrefix:[root.stringByResolvingSymlinksInPath.stringByStandardizingPath stringByAppendingString:@"/"]]) return YES;
  return NO;
}
@interface RNDesktopDragViewDriver : NSObject
@end
@implementation RNDesktopDragViewDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"testDrag", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSString *phase = request[@"phase"];
    NSEventModifierFlags modifiers;
    if (!Modifiers(request[@"modifiers"], &modifiers)) { reply(DriverFailure(@"E_INVALID_ARGUMENT", @"modifiers is a list of cmd, ctrl, option, shift and fn")); return; }
    if ([phase isEqual:@"begin"]) {
      RNDesktopDragView *view = [request[@"from"] isKindOfClass:NSString.class] ? DragViewContaining(request[@"from"]) : nil;
      if (![view canStartDrag]) { reply(DriverFailure(@"E_NOT_DRAG_SOURCE", [NSString stringWithFormat:@"No enabled Spark drag source contains %@", request[@"from"]])); return; }
      [testDrag cancel]; testDrag = nil;
      NSArray<NSDraggingItem *> *items = [view draggingItemsAt:NSMakePoint(NSMidX(view.bounds), NSMidY(view.bounds))];
      if (!items) { reply(@{ @"ok": @YES, @"started": @NO }); return; } // the view reported why through onError
      testDrag = [[SparkSimulatedDrag alloc] initWithItems:items source:view sourceMask:[view sourceMask:NO] ignoreModifiers:[view ignoresModifierKeys]];
      testDrag.modifiers = modifiers;
      NSRect frame = items.firstObject.draggingFrame;
      reply(@{ @"ok": @YES, @"started": @YES, @"items": @(items.count), @"types": testDrag.draggingPasteboard.types ?: @[], @"image": @{ @"width": @(frame.size.width), @"height": @(frame.size.height) } });
      return;
    }
    if (!testDrag) { reply(DriverFailure(@"E_INVALID_ARGUMENT", @"No test drag: begin one first")); return; }
    testDrag.modifiers = modifiers;
    if ([phase isEqual:@"move"]) {
      id to = request[@"to"];
      if (to && to != NSNull.null && (![to isKindOfClass:NSString.class] || !SparkTestDriverFindView(to))) { reply(DriverFailure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No view with testID %@", to])); return; }
      NSDragOperation operation = [testDrag moveTo:to == NSNull.null || !to ? nil : DragViewContaining(to)];
      reply(@{ @"ok": @YES, @"operation": SparkDragOperationName(operation) });
    } else if ([phase isEqual:@"drop"] || [phase isEqual:@"cancel"]) {
      SparkSimulatedDrag *drag = testDrag; testDrag = nil;
      NSDragOperation operation = NSDragOperationNone;
      if ([phase isEqual:@"drop"]) operation = [drag drop]; else [drag cancel];
      reply(@{ @"ok": @YES, @"operation": SparkDragOperationName(operation) });
    } else if ([phase isEqual:@"dropInFolder"]) {
      if (!TemporaryFolder(request[@"folder"])) { reply(DriverFailure(@"E_INVALID_ARGUMENT", @"folder must be an existing folder in a temporary directory")); return; }
      SparkSimulatedDrag *drag = testDrag; testDrag = nil;
      // Finder takes a promised file as a copy: the source must allow copy outside the app.
      if (!([(RNDesktopDragView *)drag.draggingSource sourceMask:YES] & NSDragOperationCopy)) {
        [drag cancel];
        reply(DriverFailure(@"E_INVALID_ARGUMENT", @"The drag source does not allow copy outside the app"));
        return;
      }
      [drag dropInFolder:request[@"folder"] done:^(NSArray<NSString *> *paths, NSError *error) {
        reply(paths ? @{ @"ok": @YES, @"files": paths } : DriverFailure(error.userInfo[@"code"] ?: @"E_NATIVE", error.localizedDescription));
      }];
    } else reply(DriverFailure(@"E_INVALID_ARGUMENT", @"phase is begin, move, drop, cancel or dropInFolder"));
  });
}
@end
#endif
