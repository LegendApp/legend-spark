#import "SparkClipboard.h"

NSString *const SparkClipboardErrorDomain = @"SparkClipboard";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkClipboardErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
#define FAIL(code, message) do { if (error) *error = Failure(code, message); return nil; } while (0)

// Owned data names and the pasteboard types they map to.
static NSDictionary<NSString *, NSPasteboardType> *DataTypes(void) {
  return @{ @"text": NSPasteboardTypeString, @"html": NSPasteboardTypeHTML, @"rtf": NSPasteboardTypeRTF, @"png": NSPasteboardTypePNG };
}
// nspasteboard.org markers: clipboard managers do not record concealed data (passwords) and ignore transient data.
static NSPasteboardType const ConcealedType = @"org.nspasteboard.ConcealedType";
static NSPasteboardType const TransientType = @"org.nspasteboard.TransientType";
static BOOL IsBool(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
// The marker types `args` asks for, or nil (with *error) for a non-boolean flag.
static NSArray<NSPasteboardType> *Markers(NSDictionary *args, NSError **error) {
  NSMutableArray *markers = [NSMutableArray new];
  for (NSArray *pair in @[@[@"concealed", ConcealedType], @[@"transient", TransientType]]) {
    id value = args[pair[0]];
    if (value && !IsBool(value)) FAIL(@"E_INVALID_ARGUMENT", ([NSString stringWithFormat:@"%@ must be a boolean", pair[0]]));
    if ([value boolValue]) [markers addObject:pair[1]];
  }
  return markers;
}

@class SparkClipboardProvider;
@interface SparkClipboard ()
- (nullable NSData *)provide:(NSString *)dataType provider:(SparkClipboardProvider *)provider;
- (void)providerFinished:(SparkClipboardProvider *)provider;
@end

// Supplies one promised write's data on demand. Pasteboard items retain their provider until the pasteboard no longer
// needs it (the next write by anyone), when AppKit calls pasteboardFinishedWithDataProvider:.
@interface SparkClipboardProvider : NSObject <NSPasteboardItemDataProvider>
@property (copy) NSString *identifier;
@property NSTimeInterval timeout;
@property (weak) SparkClipboard *owner;
@end
@implementation SparkClipboardProvider
- (void)pasteboard:(NSPasteboard *)pasteboard item:(NSPasteboardItem *)item provideDataForType:(NSPasteboardType)type {
  NSString *name = [DataTypes() allKeysForObject:type].firstObject;
  NSData *data = name ? [self.owner provide:name provider:self] : nil;
  if (data) [item setData:data forType:type];
}
- (void)pasteboardFinishedWithDataProvider:(NSPasteboard *)pasteboard { [self.owner providerFinished:self]; }
@end

// A promised-data request waiting for its answer from JavaScript.
@interface SparkClipboardRequest : NSObject
@property (copy) NSString *dataType;
@property (nullable) NSData *data;
@property dispatch_semaphore_t answered;
@end
@implementation SparkClipboardRequest
@end

@implementation SparkClipboard {
  SparkClipboardEmit _emit;
  NSMutableDictionary<NSNumber *, SparkClipboardRequest *> *_requests; // guarded by @synchronized(_requests)
  NSInteger _nextRequest;
  NSMutableDictionary<NSString *, SparkClipboardProvider *> *_providers;
  NSMutableDictionary<NSString *, NSNumber *> *_observers; // registration id -> interval (ms)
  NSTimer *_timer;
  NSInteger _changeCount;
  BOOL _invalidated;
}

- (instancetype)initWithPasteboard:(NSPasteboard *)pasteboard emit:(SparkClipboardEmit)emit {
  if ((self = [super init])) {
    _pasteboard = pasteboard; _emit = [emit copy];
    _requests = [NSMutableDictionary new]; _providers = [NSMutableDictionary new]; _observers = [NSMutableDictionary new];
  }
  return self;
}

- (void)invalidate {
  _invalidated = YES;
  [_observers removeAllObjects]; [self schedule];
  // A provider the pasteboard still holds answers nothing from now on.
  for (SparkClipboardProvider *provider in _providers.allValues) provider.owner = nil;
  [_providers removeAllObjects];
}
- (void)dealloc { [_timer invalidate]; }

- (nullable id)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary error:(NSError **)error {
  NSPasteboard *board = _pasteboard;
  if ([method isEqual:@"hasString"]) return @([board availableTypeFromArray:@[NSPasteboardTypeString, NSPasteboardTypeHTML, NSPasteboardTypeRTF]] != nil);
  if ([method isEqual:@"getString"] || [method isEqual:@"setString"]) return [self string:method args:args error:error];
  if ([method isEqual:@"formats"]) return board.types ?: @[];
  if ([method isEqual:@"changeCount"]) return @(board.changeCount);
  if ([method isEqual:@"clear"]) { [board clearContents]; return NSNull.null; }
  if ([method isEqual:@"read"]) return [self read];
  if ([method isEqual:@"write"]) return [self write:args error:error];
  if ([method isEqual:@"writePromised"]) return [self writePromised:args error:error];
  if ([method isEqual:@"observe"] || [method isEqual:@"unobserve"]) {
    NSString *identifier = args[@"id"];
    if (![identifier isKindOfClass:NSString.class] || !identifier.length) FAIL(@"E_INVALID_ARGUMENT", @"Expected a registration id");
    if ([method isEqual:@"unobserve"]) { [_observers removeObjectForKey:identifier]; [self schedule]; return NSNull.null; }
    NSNumber *interval = args[@"intervalMs"];
    if (![interval isKindOfClass:NSNumber.class] || IsBool(interval) || interval.doubleValue < 100 || interval.doubleValue > 10000) FAIL(@"E_INVALID_ARGUMENT", @"intervalMs must be from 100 to 10000");
    if (_invalidated) FAIL(@"E_CLOSED", @"The clipboard module was torn down");
    if (!_observers.count) _changeCount = board.changeCount; // events report changes after the first registration
    _observers[identifier] = interval;
    [self schedule];
    return NSNull.null;
  }
  FAIL(@"E_INVALID_ARGUMENT", @"Unknown clipboard operation");
}

- (nullable id)string:(NSString *)method args:(NSDictionary *)args error:(NSError **)error {
  NSPasteboard *board = _pasteboard;
  NSString *format = args[@"format"];
  if (![@[@"plainText", @"html"] containsObject:format]) FAIL(@"E_INVALID_ARGUMENT", @"Invalid clipboard string format");
  BOOL html = [format isEqual:@"html"];
  if ([method isEqual:@"setString"]) {
    NSString *text = args[@"text"];
    if (![text isKindOfClass:NSString.class]) FAIL(@"E_INVALID_ARGUMENT", @"Expected clipboard text");
    NSPasteboardItem *item = [NSPasteboardItem new];
    [item setString:text forType:html ? NSPasteboardTypeHTML : NSPasteboardTypeString];
    if (html) {
      NSAttributedString *rich = [[NSAttributedString alloc] initWithData:[text dataUsingEncoding:NSUTF8StringEncoding]
        options:@{NSDocumentTypeDocumentAttribute: NSHTMLTextDocumentType, NSCharacterEncodingDocumentAttribute: @(NSUTF8StringEncoding)} documentAttributes:nil error:nil];
      if (rich) [item setString:rich.string forType:NSPasteboardTypeString];
    }
    [board clearContents];
    return @([board writeObjects:@[item]]);
  }
  NSString *text = [board stringForType:html ? NSPasteboardTypeHTML : NSPasteboardTypeString];
  if (!text) {
    NSString *sourceType = [board availableTypeFromArray:@[NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeString]];
    NSData *data = sourceType ? [board dataForType:sourceType] : nil;
    NSString *documentType = [sourceType isEqual:NSPasteboardTypeHTML] ? NSHTMLTextDocumentType :
      [sourceType isEqual:NSPasteboardTypeRTF] ? NSRTFTextDocumentType : NSPlainTextDocumentType;
    NSAttributedString *rich = data ? [[NSAttributedString alloc] initWithData:data
      options:@{NSDocumentTypeDocumentAttribute: documentType, NSCharacterEncodingDocumentAttribute: @(NSUTF8StringEncoding)} documentAttributes:nil error:nil] : nil;
    if (html && rich) {
      NSData *encoded = [rich dataFromRange:NSMakeRange(0, rich.length) documentAttributes:@{NSDocumentTypeDocumentAttribute: NSHTMLTextDocumentType} error:nil];
      text = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
    } else text = rich.string;
  }
  return text ?: @"";
}

- (NSDictionary *)read {
  NSPasteboard *board = _pasteboard;
  NSMutableDictionary *content = [NSMutableDictionary new];
  for (NSString *key in @[@"text", @"html", @"rtf"]) { NSString *value = [board stringForType:DataTypes()[key]]; if (value) content[key] = value; }
  NSData *image = [board dataForType:NSPasteboardTypePNG];
  if (!image) { NSData *tiff = [board dataForType:NSPasteboardTypeTIFF]; if (tiff) image = [[NSBitmapImageRep imageRepWithData:tiff] representationUsingType:NSBitmapImageFileTypePNG properties:@{}]; }
  if (image) content[@"imagePNG"] = image;
  NSArray *urls = [board readObjectsForClasses:@[NSURL.class] options:@{ NSPasteboardURLReadingFileURLsOnlyKey: @YES }];
  if (urls.count) content[@"files"] = [urls valueForKey:@"path"];
  return content;
}

// Replaces the pasteboard with `objects`, the markers going on the first item, where clipboard managers look.
- (nullable id)replaceWith:(NSArray<id<NSPasteboardWriting>> *)objects markers:(NSArray<NSPasteboardType> *)markers error:(NSError **)error {
  NSPasteboard *board = _pasteboard;
  [board clearContents];
  if (objects.count && ![board writeObjects:objects]) FAIL(@"E_NATIVE", @"Could not write the clipboard");
  for (NSPasteboardType marker in markers) {
    if (!objects.count) break;
    [board addTypes:@[marker] owner:nil];
    if (![board setData:[NSData data] forType:marker]) FAIL(@"E_NATIVE", @"Could not mark the clipboard");
  }
  return NSNull.null;
}

- (nullable id)write:(NSDictionary *)args error:(NSError **)error {
  NSArray *markers = Markers(args, error);
  if (!markers) return nil;
  NSMutableArray *objects = [NSMutableArray new];
  if (args[@"files"]) {
    if (![args[@"files"] isKindOfClass:NSArray.class]) FAIL(@"E_INVALID_ARGUMENT", @"Expected file paths");
    for (NSString *file in args[@"files"]) {
      if (![file isKindOfClass:NSString.class] || !file.isAbsolutePath) FAIL(@"E_INVALID_ARGUMENT", @"Expected absolute file paths");
      [objects addObject:[NSURL fileURLWithPath:file]];
    }
  } else {
    for (NSString *key in @[@"text", @"html", @"rtf"]) if (args[key] && ![args[key] isKindOfClass:NSString.class]) FAIL(@"E_INVALID_ARGUMENT", @"Expected clipboard strings");
    NSPasteboardItem *item = [NSPasteboardItem new];
    for (NSString *key in @[@"text", @"html", @"rtf"]) if (args[key]) [item setString:args[key] forType:DataTypes()[key]];
    if (args[@"imagePNG"]) {
      NSData *image = args[@"imagePNG"];
      if (![image isKindOfClass:NSData.class] || ![NSBitmapImageRep imageRepWithData:image]) FAIL(@"E_INVALID_ARGUMENT", @"Invalid clipboard image");
      [item setData:image forType:NSPasteboardTypePNG];
    }
    if (item.types.count) [objects addObject:item];
  }
  return [self replaceWith:objects markers:markers error:error];
}

// One item whose data types come from a provider: AppKit asks for a type's data only when something pastes it.
- (nullable id)writePromised:(NSDictionary *)args error:(NSError **)error {
  NSArray *markers = Markers(args, error);
  if (!markers) return nil;
  NSArray *names = args[@"types"];
  NSString *identifier = args[@"id"];
  NSNumber *timeout = args[@"timeoutMs"];
  if (![identifier isKindOfClass:NSString.class] || !identifier.length) FAIL(@"E_INVALID_ARGUMENT", @"Expected a provider id");
  if (![timeout isKindOfClass:NSNumber.class] || IsBool(timeout) || timeout.doubleValue < 1 || timeout.doubleValue > 30000) FAIL(@"E_INVALID_ARGUMENT", @"timeoutMs must be from 1 to 30000");
  if (![names isKindOfClass:NSArray.class] || !names.count || [NSSet setWithArray:names].count != names.count) FAIL(@"E_INVALID_ARGUMENT", @"Expected distinct promised data types");
  NSMutableArray *types = [NSMutableArray new];
  for (id name in names) {
    NSPasteboardType type = [name isKindOfClass:NSString.class] ? DataTypes()[name] : nil;
    if (!type) FAIL(@"E_INVALID_ARGUMENT", @"Unknown promised data type");
    [types addObject:type];
  }
  if (_invalidated) FAIL(@"E_CLOSED", @"The clipboard module was torn down");
  SparkClipboardProvider *provider = [SparkClipboardProvider new];
  provider.identifier = identifier; provider.timeout = timeout.doubleValue / 1000; provider.owner = self;
  NSPasteboardItem *item = [NSPasteboardItem new];
  if (![item setDataProvider:provider forTypes:types]) FAIL(@"E_NATIVE", @"Could not promise clipboard data");
  _providers[identifier] = provider;
  id result = [self replaceWith:@[item] markers:markers error:error];
  if (!result) [_providers removeObjectForKey:identifier];
  return result;
}

// Main thread (AppKit asks for promised data there, also for another app's paste): asks JavaScript and waits for the
// answer up to the provider's timeout. JavaScript answers on its own thread through -answer:.
- (nullable NSData *)provide:(NSString *)dataType provider:(SparkClipboardProvider *)provider {
  if (_invalidated) return nil;
  SparkClipboardRequest *request = [SparkClipboardRequest new];
  request.dataType = dataType; request.answered = dispatch_semaphore_create(0);
  NSNumber *requestId = @(++_nextRequest);
  @synchronized (_requests) { _requests[requestId] = request; }
  _emit(@{ @"type": @"clipboardProvide", @"id": provider.identifier, @"requestId": requestId, @"dataType": dataType });
  dispatch_semaphore_wait(request.answered, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(provider.timeout * NSEC_PER_SEC)));
  @synchronized (_requests) {
    [_requests removeObjectForKey:requestId];
    return request.data;
  }
}

- (BOOL)answer:(NSInteger)requestId data:(nullable NSData *)data error:(NSError **)error {
  SparkClipboardRequest *request;
  @synchronized (_requests) {
    request = _requests[@(requestId)];
    if (!request) { if (error) *error = Failure(@"E_TIMEOUT", @"The paste stopped waiting for this clipboard data"); return NO; }
    [_requests removeObjectForKey:@(requestId)];
  }
  BOOL valid = !data || ![request.dataType isEqual:@"png"] || [NSBitmapImageRep imageRepWithData:data];
  request.data = valid ? data : nil;
  dispatch_semaphore_signal(request.answered);
  if (!valid && error) *error = Failure(@"E_INVALID_DATA", @"Promised PNG data is not an image");
  return valid;
}

- (void)providerFinished:(SparkClipboardProvider *)provider {
  if (_providers[provider.identifier] != provider) return;
  [_providers removeObjectForKey:provider.identifier];
  _emit(@{ @"type": @"clipboardProviderReleased", @"id": provider.identifier });
}

// One timer at the shortest interval any registration asked for, only while one exists. Reading changeCount is a
// cheap call that reads no clipboard contents; the timer's 10% tolerance lets the system coalesce wakeups.
- (void)schedule {
  [_timer invalidate]; _timer = nil;
  if (!_observers.count) return;
  NSNumber *shortest = [_observers.allValues valueForKeyPath:@"@min.self"];
  __weak SparkClipboard *weakSelf = self;
  _timer = [NSTimer timerWithTimeInterval:shortest.doubleValue / 1000 repeats:YES block:^(NSTimer *) { [weakSelf poll]; }];
  _timer.tolerance = shortest.doubleValue / 10000;
  [NSRunLoop.mainRunLoop addTimer:_timer forMode:NSRunLoopCommonModes];
}
- (void)poll {
  NSInteger count = _pasteboard.changeCount;
  if (count == _changeCount) return;
  _changeCount = count;
  _emit(@{ @"type": @"clipboardChanged", @"changeCount": @(count) });
}
@end
