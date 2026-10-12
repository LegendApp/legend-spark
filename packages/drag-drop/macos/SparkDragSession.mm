#import "SparkDragSession.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

NSString *const SparkDragErrorDomain = @"SparkDragDrop";
static NSError *DragError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkDragErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}

#pragma mark Operations

NSDragOperation SparkDragOperation(NSString *name) {
  return [name isEqual:@"move"] ? NSDragOperationMove : [name isEqual:@"link"] ? NSDragOperationLink : [name isEqual:@"copy"] ? NSDragOperationCopy : NSDragOperationNone;
}
NSString *SparkDragOperationName(NSDragOperation operation) {
  return operation == NSDragOperationMove || operation == NSDragOperationGeneric ? @"move" : operation == NSDragOperationLink ? @"link" : operation == NSDragOperationCopy ? @"copy" : @"none";
}
NSDragOperation SparkDragSourceMask(NSArray<NSString *> *names) {
  NSDragOperation mask = NSDragOperationNone;
  for (NSString *name in names) mask |= SparkDragOperation(name);
  return mask & NSDragOperationMove ? mask | NSDragOperationGeneric : mask;
}
NSArray<NSString *> *SparkDragAllowedOperations(NSDragOperation mask) {
  NSMutableArray *result = [NSMutableArray new];
  for (NSString *name in @[@"copy", @"move", @"link"]) {
    NSDragOperation operation = SparkDragOperation(name);
    if (mask & operation || (operation == NSDragOperationMove && mask & NSDragOperationGeneric)) [result addObject:name];
  }
  return result;
}
NSDragOperation SparkDragResolve(NSDragOperation mask, NSArray<NSString *> *accepted) {
  for (NSString *name in accepted) {
    NSDragOperation operation = SparkDragOperation(name);
    if (mask & operation || (operation == NSDragOperationMove && mask & NSDragOperationGeneric)) return operation;
  }
  return NSDragOperationNone;
}
NSPasteboardType SparkDragCustomType(NSString *mime) { return [UTType typeWithMIMEType:mime].identifier; }
NSArray<NSPasteboardType> *SparkDragPasteboardTypes(NSArray<NSString *> *types) {
  NSMutableArray *result = [NSMutableArray new];
  for (NSString *type in types) {
    NSPasteboardType pasteboardType = [type isEqual:@"files"] ? NSPasteboardTypeFileURL : [type isEqual:@"text"] ? NSPasteboardTypeString : [type isEqual:@"urls"] ? NSPasteboardTypeURL : SparkDragCustomType(type);
    if (pasteboardType) [result addObject:pasteboardType];
  }
  return result;
}

#pragma mark Promised files

@implementation SparkPromisedFiles {
  NSTimeInterval _timeout;
  void (^_request)(NSInteger, NSString *, NSString *);
  void (^_failure)(NSString *, NSString *);
  NSMutableDictionary<NSNumber *, void (^)(NSError *)> *_pending; // main thread
  NSInteger _next;
  NSOperationQueue *_queue;
}
- (instancetype)initWithTimeout:(NSTimeInterval)timeout request:(void (^)(NSInteger, NSString *, NSString *))request failure:(void (^)(NSString *, NSString *))failure {
  if ((self = [super init])) {
    _timeout = timeout; _request = request; _failure = failure; _pending = [NSMutableDictionary new];
    // AppKit asks for each write on this queue; the write itself completes on the main thread when the app answers.
    _queue = [NSOperationQueue new]; _queue.qualityOfService = NSQualityOfServiceUserInitiated;
  }
  return self;
}
- (NSUInteger)pending { return _pending.count; }
- (NSOperationQueue *)operationQueueForFilePromiseProvider:(NSFilePromiseProvider *)provider { return _queue; }
- (NSString *)filePromiseProvider:(NSFilePromiseProvider *)provider fileNameForType:(NSString *)fileType { return provider.userInfo[@"name"]; }
- (void)filePromiseProvider:(NSFilePromiseProvider *)provider writePromiseToURL:(NSURL *)url completionHandler:(void (^)(NSError *))completion {
  NSString *name = provider.userInfo[@"name"], *path = url.path;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSInteger requestId = ++self->_next;
    self->_pending[@(requestId)] = completion;
    self->_request(requestId, name, path);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(self->_timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      void (^pending)(NSError *) = self->_pending[@(requestId)];
      if (!pending) return;
      [self->_pending removeObjectForKey:@(requestId)];
      NSString *message = [NSString stringWithFormat:@"The promised file %@ was not written in time", name];
      pending(DragError(@"E_TIMEOUT", message));
      self->_failure(@"E_TIMEOUT", message);
    });
  });
}
- (BOOL)complete:(NSInteger)requestId error:(NSString *)message {
  void (^pending)(NSError *) = _pending[@(requestId)];
  if (!pending) return NO;
  [_pending removeObjectForKey:@(requestId)];
  pending(message.length ? DragError(@"E_UNAVAILABLE", message) : nil);
  return YES;
}
- (void)cancelAll {
  NSDictionary *pending = [_pending copy];
  [_pending removeAllObjects];
  for (NSNumber *requestId in pending) ((void (^)(NSError *))pending[requestId])(DragError(@"E_ABORTED", @"The drag source went away before writing its promised file"));
}
@end

#pragma mark Items

static NSString *FileType(NSDictionary *file) {
  NSString *mime = file[@"type"];
  UTType *type = [mime isKindOfClass:NSString.class] ? [UTType typeWithMIMEType:mime] : [UTType typeWithFilenameExtension:[file[@"name"] pathExtension]];
  return (type ?: UTTypeData).identifier;
}
static NSImage *Snapshot(NSView *view) {
  NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  if (!rep) return nil;
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  NSImage *image = [[NSImage alloc] initWithSize:view.bounds.size];
  [image addRepresentation:rep];
  return image;
}
NSArray<NSDraggingItem *> *SparkDragItems(NSDictionary *source, id imageSpec, NSView *view, NSPoint location, NSString *symbolDescription, SparkPromisedFiles *promises, NSError **error) {
  NSImage *image;
  NSRect frame;
  if ([imageSpec isEqual:@"view"]) {
    image = NSIsEmptyRect(view.bounds) ? nil : Snapshot(view); frame = view.bounds;
    if (!image) { *error = DragError(@"E_UNAVAILABLE", @"The drag view has no size to snapshot"); return nil; }
  } else if ([imageSpec isKindOfClass:NSDictionary.class]) {
    CGFloat width = [imageSpec[@"width"] doubleValue], height = [imageSpec[@"height"] doubleValue];
    image = [[NSImage alloc] initWithContentsOfFile:imageSpec[@"path"]];
    if (!image) { *error = DragError(@"E_NOT_FOUND", [NSString stringWithFormat:@"No drag image at %@", imageSpec[@"path"]]); return nil; }
    frame = NSMakeRect(location.x - width / 2, location.y - height / 2, width, height);
  } else {
    image = [NSImage imageWithSystemSymbolName:@"doc" accessibilityDescription:symbolDescription]; frame = NSMakeRect(location.x - 16, location.y - 16, 32, 32);
  }
  NSMutableArray *writers = [NSMutableArray new];
  for (NSString *file in source[@"files"]) if ([file hasPrefix:@"/"]) [writers addObject:[NSURL fileURLWithPath:file]];
  for (NSString *value in source[@"urls"]) { NSURL *url = [NSURL URLWithString:value]; if (url) [writers addObject:url]; }
  if (source[@"text"]) [writers addObject:source[@"text"]];
  if ([source[@"data"] count]) {
    NSPasteboardItem *custom = [NSPasteboardItem new];
    for (NSString *type in source[@"data"]) [custom setString:source[@"data"][type] forType:SparkDragCustomType(type)];
    [writers addObject:custom];
  }
  for (NSDictionary *file in source[@"promisedFiles"]) {
    NSFilePromiseProvider *provider = [[NSFilePromiseProvider alloc] initWithFileType:FileType(file) delegate:promises];
    provider.userInfo = @{ @"name": file[@"name"] };
    [writers addObject:provider];
  }
  if (!writers.count) { *error = DragError(@"E_INVALID_ARGUMENT", @"The drag source has nothing to drag"); return nil; }
  NSMutableArray *items = [NSMutableArray new];
  for (id<NSPasteboardWriting> writer in writers) {
    NSDraggingItem *item = [[NSDraggingItem alloc] initWithPasteboardWriter:writer];
    [item setDraggingFrame:frame contents:image];
    [items addObject:item];
  }
  return items;
}

#pragma mark Simulated session (test driver builds only)

#if SPARK_TEST_DRIVER
NSDragOperation SparkDragModifierMask(NSDragOperation mask, NSEventModifierFlags modifiers) {
  if (modifiers & NSEventModifierFlagControl) return mask & NSDragOperationLink;
  if (modifiers & NSEventModifierFlagOption) return mask & NSDragOperationCopy;
  if (modifiers & NSEventModifierFlagCommand) return mask & NSDragOperationGeneric;
  return mask;
}

@implementation SparkSimulatedDrag {
  NSArray<NSDraggingItem *> *_items;
  __weak id _source;
  NSDragOperation _mask, _operation;
  BOOL _ignore, _ended;
  NSPasteboard *_pasteboard;
  NSInteger _sequence;
  NSTimer *_spring;
  NSSpringLoadingHighlight _highlight;
}
@synthesize draggingFormation, animatesToDestination, numberOfValidItemsForDrop;
- (instancetype)initWithItems:(NSArray<NSDraggingItem *> *)items source:(id)source sourceMask:(NSDragOperation)mask ignoreModifiers:(BOOL)ignore {
  if ((self = [super init])) {
    static NSInteger sequence = 0;
    _items = items; _source = source; _mask = mask; _ignore = ignore; _sequence = ++sequence;
    _pasteboard = [NSPasteboard pasteboardWithUniqueName];
    [_pasteboard clearContents];
    [_pasteboard writeObjects:[items valueForKey:@"item"]];
    numberOfValidItemsForDrop = (NSInteger)items.count;
  }
  return self;
}
- (void)dealloc { [_spring invalidate]; [_pasteboard releaseGlobally]; }
- (NSWindow *)draggingDestinationWindow { return _destination.window; }
- (NSDragOperation)draggingSourceOperationMask { return _ignore ? _mask : SparkDragModifierMask(_mask, _modifiers); }
- (NSPoint)draggingLocation { return _destination ? [_destination convertPoint:NSMakePoint(NSMidX(_destination.bounds), NSMidY(_destination.bounds)) toView:nil] : NSZeroPoint; }
- (NSPoint)draggedImageLocation { return self.draggingLocation; }
- (NSImage *)draggedImage { return nil; }
- (NSPasteboard *)draggingPasteboard { return _pasteboard; }
- (id)draggingSource { return _source; }
- (NSInteger)draggingSequenceNumber { return _sequence; }
- (void)slideDraggedImageTo:(NSPoint)screenPoint {}
- (NSArray<NSString *> *)namesOfPromisedFilesDroppedAtDestination:(NSURL *)dropDestination { return nil; }
- (void)enumerateDraggingItemsWithOptions:(NSDraggingItemEnumerationOptions)options forView:(NSView *)view classes:(NSArray<Class> *)classes
  searchOptions:(NSDictionary<NSPasteboardReadingOptionKey, id> *)searchOptions usingBlock:(void (^)(NSDraggingItem *, NSInteger, BOOL *))block {
  BOOL stop = NO;
  for (NSInteger index = 0; index < (NSInteger)_items.count && !stop; index++) block(_items[index], index, &stop);
}
- (NSSpringLoadingHighlight)springLoadingHighlight { return _highlight; }
- (void)resetSpringLoading { [self leaveSpringLoading]; [self enterSpringLoading]; }

- (void)highlight:(NSSpringLoadingHighlight)highlight {
  if (_highlight == highlight) return;
  _highlight = highlight;
  [(id<NSSpringLoadingDestination>)_destination springLoadingHighlightChanged:self];
}
- (void)enterSpringLoading {
  if (![_destination conformsToProtocol:@protocol(NSSpringLoadingDestination)]) return;
  id<NSSpringLoadingDestination> destination = (id<NSSpringLoadingDestination>)_destination;
  if (!([destination springLoadingEntered:self] & NSSpringLoadingEnabled)) return;
  [self highlight:NSSpringLoadingHighlightStandard];
  // The system's springing delay (the Finder's Spring-loading setting).
  NSNumber *delay = [NSUserDefaults.standardUserDefaults objectForKey:@"com.apple.springing.delay"];
  __weak SparkSimulatedDrag *weakSelf = self;
  _spring = [NSTimer timerWithTimeInterval:delay ? delay.doubleValue : 0.5 repeats:NO block:^(NSTimer *) {
    SparkSimulatedDrag *drag = weakSelf;
    if (!drag || drag->_destination != (NSView *)destination) return;
    drag->_spring = nil;
    [drag highlight:NSSpringLoadingHighlightEmphasized];
    drag->_springLoads++;
    [destination springLoadingActivated:YES draggingInfo:drag];
    [drag highlight:NSSpringLoadingHighlightNone];
  }];
  [NSRunLoop.mainRunLoop addTimer:_spring forMode:NSRunLoopCommonModes];
}
- (void)leaveSpringLoading {
  if (![_destination conformsToProtocol:@protocol(NSSpringLoadingDestination)]) return;
  [_spring invalidate]; _spring = nil;
  [self highlight:NSSpringLoadingHighlightNone];
  id<NSSpringLoadingDestination> destination = (id<NSSpringLoadingDestination>)_destination;
  if ([destination respondsToSelector:@selector(springLoadingExited:)]) [destination springLoadingExited:self];
}
- (NSDragOperation)moveTo:(NSView<NSDraggingDestination> *)destination {
  if (_ended) return NSDragOperationNone;
  if (destination != _destination) {
    if (_destination) {
      [self leaveSpringLoading];
      if ([_destination respondsToSelector:@selector(draggingExited:)]) [_destination draggingExited:self];
    }
    _destination = destination; _operation = NSDragOperationNone;
    if (destination) {
      if ([destination respondsToSelector:@selector(draggingEntered:)]) _operation = [destination draggingEntered:self];
      [self enterSpringLoading];
    }
  } else if (destination) {
    if ([destination respondsToSelector:@selector(draggingUpdated:)]) _operation = [destination draggingUpdated:self];
    if ([destination conformsToProtocol:@protocol(NSSpringLoadingDestination)] && [destination respondsToSelector:@selector(springLoadingUpdated:)])
      [(id<NSSpringLoadingDestination>)destination springLoadingUpdated:self];
  }
  return _operation;
}
- (void)end:(NSDragOperation)operation {
  if (_ended) return;
  _ended = YES;
  if ([_source respondsToSelector:@selector(draggingSession:endedAtPoint:operation:)]) [_source draggingSession:(NSDraggingSession *_Nonnull)nil endedAtPoint:NSZeroPoint operation:operation];
}
- (NSDragOperation)drop {
  NSView<NSDraggingDestination> *destination = _destination;
  NSDragOperation operation = NSDragOperationNone;
  if (destination && !_ended) {
    [self leaveSpringLoading];
    if (_operation == NSDragOperationNone) { if ([destination respondsToSelector:@selector(draggingExited:)]) [destination draggingExited:self]; }
    else if ((![destination respondsToSelector:@selector(prepareForDragOperation:)] || [destination prepareForDragOperation:self]) && [destination performDragOperation:self]) {
      operation = _operation;
      if ([destination respondsToSelector:@selector(concludeDragOperation:)]) [destination concludeDragOperation:self];
    }
  }
  _destination = nil;
  [self end:operation];
  return operation;
}
- (void)cancel {
  if (_destination) {
    [self leaveSpringLoading];
    if ([_destination respondsToSelector:@selector(draggingExited:)]) [_destination draggingExited:self];
    _destination = nil;
  }
  [self end:NSDragOperationNone];
}
- (void)dropInFolder:(NSString *)folder done:(void (^)(NSArray<NSString *> *, NSError *))done {
  NSMutableArray<NSFilePromiseProvider *> *providers = [NSMutableArray new];
  for (NSDraggingItem *item in _items) if ([item.item isKindOfClass:NSFilePromiseProvider.class]) [providers addObject:item.item];
  if (_ended || !providers.count) { [self cancel]; done(nil, DragError(@"E_INVALID_ARGUMENT", _ended ? @"The drag has ended" : @"The drag has no promised files")); return; }
  [self moveTo:nil];
  // Finder accepts the drop as a copy, then waits for each promised file.
  [self end:NSDragOperationCopy];
  NSMutableArray<NSString *> *paths = [NSMutableArray new];
  __block NSUInteger remaining = providers.count;
  __block NSError *failure = nil;
  for (NSFilePromiseProvider *provider in providers) {
    id<NSFilePromiseProviderDelegate> delegate = provider.delegate;
    NSString *name = [delegate filePromiseProvider:provider fileNameForType:provider.fileType];
    NSURL *url = [NSURL fileURLWithPath:[folder stringByAppendingPathComponent:name]];
    [paths addObject:url.path];
    NSOperationQueue *queue = [delegate respondsToSelector:@selector(operationQueueForFilePromiseProvider:)] ? [delegate operationQueueForFilePromiseProvider:provider] : NSOperationQueue.mainQueue;
    [queue addOperationWithBlock:^{
      [delegate filePromiseProvider:provider writePromiseToURL:url completionHandler:^(NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (error && !failure) failure = error;
          if (--remaining == 0) done(failure ? nil : paths, failure);
        });
      }];
    }];
  }
}
@end
#endif
