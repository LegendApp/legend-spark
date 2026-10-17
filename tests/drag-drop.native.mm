#import <AppKit/AppKit.h>
#include <cstdio>
#import "SparkDragSession.h"

// Usage: drag-drop <scenario> [-com.apple.springing.delay 0.2]. Drives @legendapp/spark/drag-drop's SparkDragSession: operation masks, dragging items,
// promised files written into a private temporary folder, and simulated sessions over test destinations. Nothing is
// shown, no real drag starts, and no folder outside the temporary directory is written.
static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)
static void Spin(NSTimeInterval seconds) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }

// A destination that records what a drag does to it, accepting copy, move and link in `accepted` order.
@interface TestDestination : NSView <NSDraggingDestination, NSSpringLoadingDestination>
@property NSArray<NSString *> *accepted;
@property BOOL springLoading;
@property NSMutableArray<NSString *> *log;
@property NSString *dropped;
@property NSArray<NSString *> *allowed;
@end
@implementation TestDestination
- (instancetype)initWithFrame:(NSRect)frame { if ((self = [super initWithFrame:frame])) { _log = [NSMutableArray new]; _accepted = @[@"move", @"copy", @"link"]; } return self; }
- (NSDragOperation)operation:(id<NSDraggingInfo>)info {
  _allowed = SparkDragAllowedOperations(info.draggingSourceOperationMask);
  return [info.draggingPasteboard availableTypeFromArray:SparkDragPasteboardTypes(@[@"text", @"files", @"urls"])] ? SparkDragResolve(info.draggingSourceOperationMask, _accepted) : NSDragOperationNone;
}
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)info { [_log addObject:@"enter"]; return [self operation:info]; }
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)info { [_log addObject:@"over"]; return [self operation:info]; }
- (void)draggingExited:(id<NSDraggingInfo>)info { [_log addObject:@"exit"]; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)info { [_log addObject:@"drop"]; _dropped = [info.draggingPasteboard stringForType:NSPasteboardTypeString]; return YES; }
- (NSSpringLoadingOptions)springLoadingEntered:(id<NSDraggingInfo>)info { return _springLoading ? NSSpringLoadingEnabled : NSSpringLoadingDisabled; }
- (void)springLoadingHighlightChanged:(id<NSDraggingInfo>)info { [_log addObject:[NSString stringWithFormat:@"highlight %ld", (long)info.springLoadingHighlight]]; }
- (void)springLoadingActivated:(BOOL)activated draggingInfo:(id<NSDraggingInfo>)info { [_log addObject:activated ? @"spring" : @"unspring"]; }
@end
@interface TestSource : NSObject
@property NSMutableArray<NSString *> *ended;
@property NSPoint endedAt;
@end
@implementation TestSource
- (instancetype)init { if ((self = [super init])) _ended = [NSMutableArray new]; return self; }
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation { [_ended addObject:SparkDragOperationName(operation)]; _endedAt = point; }
@end

static SparkPromisedFiles *Promises(NSTimeInterval timeout, void (^request)(NSInteger, NSString *, NSString *), NSMutableArray *failuresSeen) {
  return [[SparkPromisedFiles alloc] initWithTimeout:timeout request:request failure:^(NSString *code, NSString *message) { [failuresSeen addObject:code]; }];
}
static NSArray<NSDraggingItem *> *Items(NSDictionary *source, id image, NSView *view, SparkPromisedFiles *promises, NSString **code = nullptr) {
  NSError *error = nil;
  NSArray *items = SparkDragItems(source, image, view, NSMakePoint(50, 20), @"Dragged item", promises, &error);
  if (code) *code = error.userInfo[@"code"];
  return items;
}

static void Operations(void) {
  NSDragOperation all = SparkDragSourceMask(@[@"copy", @"move", @"link"]);
  CHECK(all == (NSDragOperationCopy | NSDragOperationMove | NSDragOperationLink | NSDragOperationGeneric));
  CHECK(SparkDragSourceMask(@[@"copy"]) == NSDragOperationCopy);
  CHECK([SparkDragAllowedOperations(all) isEqual:(@[@"copy", @"move", @"link"])]);
  CHECK([SparkDragAllowedOperations(NSDragOperationGeneric) isEqual:@[@"move"]]);
  // Modifiers narrow the source's mask as AppKit documents; the destination's order picks among what is left.
  CHECK(SparkDragModifierMask(all, 0) == all);
  CHECK(SparkDragModifierMask(all, NSEventModifierFlagOption) == NSDragOperationCopy);
  CHECK(SparkDragModifierMask(all, NSEventModifierFlagControl) == NSDragOperationLink);
  CHECK(SparkDragModifierMask(all, NSEventModifierFlagCommand) == NSDragOperationGeneric);
  CHECK(SparkDragModifierMask(all, NSEventModifierFlagControl | NSEventModifierFlagOption) == NSDragOperationLink);
  CHECK(SparkDragModifierMask(SparkDragSourceMask(@[@"copy"]), NSEventModifierFlagCommand) == NSDragOperationNone);
  CHECK(SparkDragModifierMask(all, NSEventModifierFlagShift) == all);
  CHECK(SparkDragResolve(all, @[@"move", @"copy"]) == NSDragOperationMove);
  CHECK(SparkDragResolve(NSDragOperationGeneric, @[@"copy", @"move"]) == NSDragOperationMove);
  CHECK(SparkDragResolve(NSDragOperationCopy, @[@"move", @"link"]) == NSDragOperationNone);
  CHECK(SparkDragResolve(all, @[]) == NSDragOperationNone);
  CHECK([SparkDragOperationName(NSDragOperationGeneric) isEqual:@"move"] && [SparkDragOperationName(NSDragOperationNone) isEqual:@"none"]);
  CHECK([SparkDragPasteboardTypes(@[@"files", @"text", @"urls", @"application/json"]) isEqual:(@[NSPasteboardTypeFileURL, NSPasteboardTypeString, NSPasteboardTypeURL, @"public.json"])]);
}

static void ItemsScenario(void) {
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 120, 40)];
  SparkPromisedFiles *promises = Promises(5, ^(NSInteger, NSString *, NSString *) {}, nil);
  NSString *code = nil;
  // One item per representation, each with the default document symbol centered on the pointer.
  NSArray<NSDraggingItem *> *items = Items(@{ @"text": @"hello", @"urls": @[@"https://example.com"], @"files": @[@"/tmp/a"], @"data": @{ @"application/json": @"{}" },
    @"promisedFiles": @[@{ @"name": @"Notes.txt" }, @{ @"name": @"data", @"type": @"application/json" }] }, nil, view, promises);
  CHECK(items.count == 6);
  CHECK(NSEqualRects(items.firstObject.draggingFrame, NSMakeRect(34, 4, 32, 32)));
  NSArray<NSFilePromiseProvider *> *providers = [[items valueForKey:@"item"] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"self isKindOfClass: %@", NSFilePromiseProvider.class]];
  CHECK(providers.count == 2);
  CHECK([providers[0].fileType isEqual:@"public.plain-text"] && [providers[1].fileType isEqual:@"public.json"]);
  CHECK([[promises filePromiseProvider:providers[0] fileNameForType:providers[0].fileType] isEqual:@"Notes.txt"]);
  CHECK(providers[0].delegate == promises);
  // "view": a snapshot of the view, at the view's frame.
  items = Items(@{ @"text": @"hello" }, @"view", view, promises);
  CHECK(items.count == 1 && NSEqualRects(items[0].draggingFrame, view.bounds));
  NSImage *contents = items[0].imageComponents.firstObject.contents;
  CHECK([contents isKindOfClass:NSImage.class] && NSEqualSizes(contents.size, view.bounds.size));
  // An image file, at the requested size centered on the pointer.
  NSString *png = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-drag-image-%d.png", getpid()]];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:8 pixelsHigh:8 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  CHECK([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:png atomically:YES]);
  items = Items(@{ @"text": @"hello" }, @{ @"path": png, @"width": @64, @"height": @48 }, view, promises);
  CHECK(items.count == 1 && NSEqualRects(items[0].draggingFrame, NSMakeRect(18, -4, 64, 48)));
  [NSFileManager.defaultManager removeItemAtPath:png error:nil];
  // A missing image file or an empty source starts no drag.
  CHECK(!Items(@{ @"text": @"hello" }, @{ @"path": png, @"width": @64, @"height": @48 }, view, promises, &code) && [code isEqual:@"E_NOT_FOUND"]);
  CHECK(!Items(@{}, nil, view, promises, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!Items(@{ @"text": @"x" }, @"view", [[NSView alloc] initWithFrame:NSZeroRect], promises, &code) && [code isEqual:@"E_UNAVAILABLE"]);
}

static void Promised(void) {
  NSString *folder = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-drag-promised-%d", getpid()]];
  [NSFileManager.defaultManager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 120, 40)];
  NSMutableArray *requests = [NSMutableArray new], *failed = [NSMutableArray new];
  __block SparkPromisedFiles *promises = Promises(0.3, ^(NSInteger requestId, NSString *name, NSString *path) {
    [requests addObject:@[@(requestId), name, path]];
    // The app writes asynchronously, then answers.
    dispatch_async(dispatch_get_main_queue(), ^{
      if ([name hasPrefix:@"slow"]) return;
      if ([name hasPrefix:@"fail"]) { [promises complete:requestId error:@"disk full"]; return; }
      [[@"promised " stringByAppendingString:name] writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
      CHECK([promises complete:requestId error:nil]);
      CHECK(![promises complete:requestId error:nil]); // answered once
    });
  }, failed);
  TestSource *source = [TestSource new];
  // Written on demand into the drop folder; the source sees Finder's copy at once.
  SparkSimulatedDrag *drag = [[SparkSimulatedDrag alloc] initWithItems:Items(@{ @"promisedFiles": @[@{ @"name": @"Notes.txt" }, @{ @"name": @"More.txt" }] }, nil, view, promises) source:source
    sourceMask:NSDragOperationCopy ignoreModifiers:NO];
  CHECK(requests.count == 0);
  __block NSArray *written = nil; __block NSError *writeError = nil; __block BOOL done = NO;
  [drag dropInFolder:folder done:^(NSArray *paths, NSError *error) { written = paths; writeError = error; done = YES; }];
  CHECK([source.ended isEqual:@[@"copy"]]);
  for (int i = 0; i < 100 && !done; i++) Spin(0.02);
  CHECK(done && !writeError && written.count == 2 && requests.count == 2);
  CHECK([[NSString stringWithContentsOfFile:[folder stringByAppendingPathComponent:@"Notes.txt"] encoding:NSUTF8StringEncoding error:nil] isEqual:@"promised Notes.txt"]);
  CHECK([[NSString stringWithContentsOfFile:[folder stringByAppendingPathComponent:@"More.txt"] encoding:NSUTF8StringEncoding error:nil] isEqual:@"promised More.txt"]);
  CHECK(promises.pending == 0 && failed.count == 0);
  // A failed write and a write that never comes (E_TIMEOUT, reported) give the destination an error.
  for (NSString *name in @[@"fail.txt", @"slow.txt"]) {
    done = NO; writeError = nil;
    drag = [[SparkSimulatedDrag alloc] initWithItems:Items(@{ @"promisedFiles": @[@{ @"name": name }] }, nil, view, promises) source:source sourceMask:NSDragOperationCopy ignoreModifiers:NO];
    [drag dropInFolder:folder done:^(NSArray *paths, NSError *error) { writeError = error; done = YES; }];
    for (int i = 0; i < 100 && !done; i++) Spin(0.02);
    CHECK(done && [writeError.userInfo[@"code"] isEqual:[name hasPrefix:@"fail"] ? @"E_UNAVAILABLE" : @"E_TIMEOUT"]);
  }
  CHECK([failed isEqual:@[@"E_TIMEOUT"]]);
  // Pending writes fail when the source goes away.
  promises = Promises(10, ^(NSInteger, NSString *, NSString *) {}, failed);
  done = NO;
  drag = [[SparkSimulatedDrag alloc] initWithItems:Items(@{ @"promisedFiles": @[@{ @"name": @"gone.txt" }] }, nil, view, promises) source:source sourceMask:NSDragOperationCopy ignoreModifiers:NO];
  [drag dropInFolder:folder done:^(NSArray *paths, NSError *error) { writeError = error; done = YES; }];
  for (int i = 0; i < 50 && promises.pending == 0; i++) Spin(0.02);
  [promises cancelAll];
  for (int i = 0; i < 50 && !done; i++) Spin(0.02);
  CHECK(done && [writeError.userInfo[@"code"] isEqual:@"E_ABORTED"]);
  // A drag without promised files cannot drop in a folder.
  done = NO;
  drag = [[SparkSimulatedDrag alloc] initWithItems:Items(@{ @"text": @"x" }, nil, view, promises) source:source sourceMask:NSDragOperationCopy ignoreModifiers:NO];
  [drag dropInFolder:folder done:^(NSArray *paths, NSError *error) { writeError = error; done = YES; }];
  CHECK(done && [writeError.userInfo[@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK([[[NSFileManager.defaultManager contentsOfDirectoryAtPath:folder error:nil] sortedArrayUsingSelector:@selector(compare:)] isEqual:(@[@"More.txt", @"Notes.txt"])]);
  [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
}

static void Session(void) {
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 120, 40)];
  SparkPromisedFiles *promises = Promises(5, ^(NSInteger, NSString *, NSString *) {}, nil);
  TestDestination *target = [[TestDestination alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)], *other = [[TestDestination alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)];
  TestSource *source = [TestSource new];
  NSDragOperation all = SparkDragSourceMask(@[@"copy", @"move", @"link"]);
  auto drag = ^(BOOL ignore) { return [[SparkSimulatedDrag alloc] initWithItems:Items(@{ @"text": @"payload" }, nil, view, promises) source:source sourceMask:all ignoreModifiers:ignore]; };
  // No modifier: the destination's first accepted operation. Option, Command and Control select copy, move and link.
  NSDictionary *expected = @{ @0: @"move", @(NSEventModifierFlagOption): @"copy", @(NSEventModifierFlagCommand): @"move", @(NSEventModifierFlagControl): @"link" };
  for (NSNumber *modifiers in expected) {
    SparkSimulatedDrag *session = drag(NO);
    session.modifiers = modifiers.unsignedIntegerValue;
    target.accepted = @[@"move", @"copy", @"link"];
    [session moveTo:target];
    CHECK([SparkDragOperationName([session moveTo:target]) isEqual:expected[modifiers]]);
    CHECK([SparkDragOperationName([session drop]) isEqual:expected[modifiers]]);
    CHECK([target.dropped isEqual:@"payload"]);
  }
  CHECK(source.ended.count == 4);
  // With ignoreModifiers the full mask stays: Option still moves.
  SparkSimulatedDrag *session = drag(YES);
  session.modifiers = NSEventModifierFlagOption;
  CHECK([session moveTo:target] == NSDragOperationMove && [target.allowed isEqual:(@[@"copy", @"move", @"link"])]);
  [session cancel];
  // A modifier the destination cannot honor refuses the drop: Control (link) on a copy/move destination.
  session = drag(NO); session.modifiers = NSEventModifierFlagControl; target.accepted = @[@"copy", @"move"];
  CHECK([session moveTo:target] == NSDragOperationNone && [target.allowed isEqual:@[@"link"]]);
  [source.ended removeAllObjects];
  CHECK([session drop] == NSDragOperationNone && [source.ended isEqual:@[@"none"]]);
  CHECK([target.log.lastObject isEqual:@"exit"]);
  // Enter, update, exit and drop reach the destination under the pointer.
  [target.log removeAllObjects]; [other.log removeAllObjects]; target.accepted = @[@"copy"];
  session = drag(NO);
  [session moveTo:target]; [session moveTo:target]; [session moveTo:other]; [session moveTo:nil]; [session moveTo:target];
  CHECK([target.log isEqual:(@[@"enter", @"over", @"exit", @"enter"])] && [other.log isEqual:(@[@"enter", @"exit"])]);
  CHECK([session drop] == NSDragOperationCopy && [target.log.lastObject isEqual:@"drop"]);
  // Spring loading (springing delay 0.2 s from the arguments): a hold past the delay activates once; leaving earlier does not.
  CHECK([NSUserDefaults.standardUserDefaults doubleForKey:@"com.apple.springing.delay"] == 0.2);
  target.springLoading = YES; [target.log removeAllObjects];
  session = drag(NO);
  [session moveTo:target];
  Spin(0.4);
  CHECK(session.springLoads == 1);
  CHECK([target.log isEqual:(@[@"enter", @"highlight 1", @"highlight 2", @"spring", @"highlight 0"])]);
  [session cancel];
  [target.log removeAllObjects];
  session = drag(NO);
  [session moveTo:target]; Spin(0.05); [session moveTo:other]; Spin(0.3);
  CHECK(session.springLoads == 0 && [target.log isEqual:(@[@"enter", @"highlight 1", @"highlight 0", @"exit"])]);
  [session cancel];
  target.springLoading = NO; [target.log removeAllObjects];
  session = drag(NO);
  [session moveTo:target]; Spin(0.3);
  CHECK(session.springLoads == 0 && [target.log isEqual:@[@"enter"]]);
  [session cancel];
  // The pointer goes where the drag moves: a destination's center, or an offset (y downward) over nothing, where a
  // tear-off lands. The source hears where it ended, in screen coordinates.
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(300, 200, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  target.frame = NSMakeRect(20, 30, 100, 100); [window.contentView addSubview:target]; [target.log removeAllObjects];
  session = drag(NO); session.screenLocation = NSMakePoint(10, 10);
  [session moveTo:target];
  CHECK(NSEqualPoints(session.screenLocation, NSMakePoint(370, 280)));
  CHECK([session moveBy:NSMakeSize(-500, 40)] == NSDragOperationNone && NSEqualPoints(session.screenLocation, NSMakePoint(-130, 240)) && [target.log.lastObject isEqual:@"exit"]);
  [source.ended removeAllObjects];
  CHECK([session drop] == NSDragOperationNone && [source.ended isEqual:@[@"none"]] && NSEqualPoints(source.endedAt, NSMakePoint(-130, 240)));
  CHECK([session moveBy:NSMakeSize(1, 1)] == NSDragOperationNone && NSEqualPoints(session.screenLocation, NSMakePoint(-130, 240)));
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSString *scenario = argc > 1 ? @(argv[1]) : @"";
    if ([scenario isEqual:@"operations"]) Operations();
    else if ([scenario isEqual:@"items"]) ItemsScenario();
    else if ([scenario isEqual:@"promised"]) Promised();
    else if ([scenario isEqual:@"session"]) Session();
    else { fprintf(stderr, "unknown scenario\n"); return 2; }
    if (failures) return 1;
    printf("PASS %s\n", scenario.UTF8String);
  }
  return 0;
}
