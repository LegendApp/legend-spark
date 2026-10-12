#import <AppKit/AppKit.h>
#include <cstdio>
#import "SparkClipboard.h"

// Usage: clipboard <scenario>. Drives @legendapp/spark/clipboard's SparkClipboard against a private pasteboard
// (pasteboardWithUniqueName), released at exit. The general pasteboard is never read or written: every scenario
// checks that its change count did not move.
static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)

static NSMutableArray<NSDictionary *> *events;
static id (^answerWith)(NSDictionary *request); // NSData, NSNull (the provider failed: answer nothing) or nil (leave unanswered)
static SparkClipboard *clipboard;

static id Perform(NSString *method, NSDictionary *args, NSString **code = nullptr) {
  NSError *error = nil;
  id value = [clipboard perform:method args:args binary:YES error:&error];
  if (code) *code = error.userInfo[@"code"];
  else if (error) { fprintf(stderr, "%s failed: %s\n", method.UTF8String, error.localizedDescription.UTF8String); failures++; }
  return value;
}
static void Spin(NSTimeInterval seconds) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }
static NSArray *EventsOfType(NSString *type) { return [events filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"type == %@", type]]; }
static NSData *PNG(void) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:2 pixelsHigh:2 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  return [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}

static void Operations(NSPasteboard *board) {
  CHECK([Perform(@"setString", @{ @"text": @"plain", @"format": @"plainText" }) isEqual:@YES]);
  CHECK([Perform(@"getString", @{ @"format": @"plainText" }) isEqual:@"plain"]);
  CHECK([Perform(@"hasString", @{}) isEqual:@YES]);
  CHECK([Perform(@"setString", @{ @"text": @"<b>bold</b>", @"format": @"html" }) isEqual:@YES]);
  CHECK([[Perform(@"getString", @{ @"format": @"plainText" }) stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] isEqual:@"bold"]);
  NSString *code;
  CHECK(!Perform(@"getString", @{ @"format": @"rtf" }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);

  NSInteger before = board.changeCount;
  Perform(@"write", @{ @"text": @"t", @"html": @"<i>t</i>", @"imagePNG": PNG() });
  CHECK([Perform(@"changeCount", @{}) integerValue] == board.changeCount && board.changeCount > before);
  NSDictionary *read = Perform(@"read", @{});
  CHECK([read[@"text"] isEqual:@"t"] && [read[@"html"] isEqual:@"<i>t</i>"] && [read[@"imagePNG"] isKindOfClass:NSData.class]);
  CHECK(![Perform(@"formats", @{}) containsObject:@"org.nspasteboard.ConcealedType"]);
  CHECK(!Perform(@"write", @{ @"imagePNG": [@"not a png" dataUsingEncoding:NSUTF8StringEncoding] }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!Perform(@"write", @{ @"files": @[@"relative"] }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);

  // Concealed and transient markers go on the first item, beside the data; text, files and promised data alike.
  Perform(@"write", @{ @"text": @"secret", @"concealed": @YES, @"transient": @YES });
  NSArray *types = board.pasteboardItems.firstObject.types;
  CHECK([types containsObject:@"org.nspasteboard.ConcealedType"] && [types containsObject:@"org.nspasteboard.TransientType"] && [types containsObject:NSPasteboardTypeString]);
  CHECK([[board stringForType:NSPasteboardTypeString] isEqual:@"secret"]);
  Perform(@"write", @{ @"files": @[@"/tmp/a.txt", @"/tmp/b.txt"], @"concealed": @YES });
  CHECK([board.pasteboardItems.firstObject.types containsObject:@"org.nspasteboard.ConcealedType"] && ![board.types containsObject:@"org.nspasteboard.TransientType"]);
  CHECK([[Perform(@"read", @{}) objectForKey:@"files"] isEqual:(@[@"/tmp/a.txt", @"/tmp/b.txt"])]);
  CHECK(!Perform(@"write", @{ @"text": @"x", @"concealed": @1 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);

  CHECK(Perform(@"clear", @{}) == NSNull.null && board.types.count == 0 && [Perform(@"hasString", @{}) isEqual:@NO]);
  CHECK(!Perform(@"bogus", @{}, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
}

static void Promised(NSPasteboard *board) {
  NSData *png = PNG();
  answerWith = ^id (NSDictionary *request) {
    NSString *type = request[@"dataType"];
    if ([type isEqual:@"png"]) return png;
    return [[NSString stringWithFormat:@"%@ data", type] dataUsingEncoding:NSUTF8StringEncoding];
  };
  Perform(@"writePromised", @{ @"id": @"p1", @"types": @[@"text", @"html", @"png"], @"timeoutMs": @2000, @"concealed": @YES });
  // Promising provides nothing yet.
  CHECK(EventsOfType(@"clipboardProvide").count == 0);
  CHECK([board.types containsObject:NSPasteboardTypeHTML] && [board.types containsObject:NSPasteboardTypePNG] && [board.types containsObject:@"org.nspasteboard.ConcealedType"]);
  // A paste asks for one type at a time, on demand.
  CHECK([[board stringForType:NSPasteboardTypeHTML] isEqual:@"html data"]);
  NSArray *provided = EventsOfType(@"clipboardProvide");
  CHECK(provided.count == 1 && [provided[0][@"id"] isEqual:@"p1"] && [provided[0][@"dataType"] isEqual:@"html"]);
  CHECK([[board dataForType:NSPasteboardTypePNG] isEqual:png]);
  CHECK([[board stringForType:NSPasteboardTypeString] isEqual:@"text data"]);
  CHECK(EventsOfType(@"clipboardProvide").count == 3);
  // Once every promised type has been provided, AppKit releases the provider.
  NSArray *released = EventsOfType(@"clipboardProviderReleased");
  CHECK(released.count == 1 && [released[0][@"id"] isEqual:@"p1"]);
  NSString *code;
  CHECK(!Perform(@"writePromised", @{ @"id": @"bad", @"types": @[@"text", @"text"], @"timeoutMs": @100 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!Perform(@"writePromised", @{ @"id": @"bad", @"types": @[@"pdf"], @"timeoutMs": @100 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!Perform(@"writePromised", @{ @"id": @"bad", @"types": @[@"text"], @"timeoutMs": @0 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);

  // The next write releases a provider with types still unprovided.
  Perform(@"writePromised", @{ @"id": @"p0", @"types": @[@"text", @"html"], @"timeoutMs": @300 });
  [events removeAllObjects];
  Perform(@"writePromised", @{ @"id": @"p2", @"types": @[@"text", @"png"], @"timeoutMs": @300 });
  released = EventsOfType(@"clipboardProviderReleased");
  CHECK(released.count == 1 && [released[0][@"id"] isEqual:@"p0"]);

  // A provider that fails answers nothing at once; an unanswered request gives up after the timeout, and its late
  // answer is refused with E_TIMEOUT; an undecodable PNG is refused and the paste gets nothing.
  answerWith = ^id (NSDictionary *) { return NSNull.null; };
  NSDate *start = NSDate.date;
  CHECK([board stringForType:NSPasteboardTypeString] == nil && -start.timeIntervalSinceNow < 0.25);
  __block NSInteger lateRequest = 0;
  start = NSDate.date;
  answerWith = ^id (NSDictionary *request) { lateRequest = [request[@"requestId"] integerValue]; return nil; };
  CHECK([board dataForType:NSPasteboardTypePNG] == nil);
  NSTimeInterval waited = -start.timeIntervalSinceNow;
  CHECK(waited >= 0.28 && waited < 2);
  NSError *error = nil;
  CHECK(lateRequest > 0 && ![clipboard answer:lateRequest data:[NSData data] error:&error] && [error.userInfo[@"code"] isEqual:@"E_TIMEOUT"]);

  Perform(@"writePromised", @{ @"id": @"p3", @"types": @[@"png"], @"timeoutMs": @2000 });
  answerWith = ^id (NSDictionary *) { return [@"no image" dataUsingEncoding:NSUTF8StringEncoding]; };
  start = NSDate.date;
  CHECK([board dataForType:NSPasteboardTypePNG] == nil && -start.timeIntervalSinceNow < 1);
  Spin(0.05);
  CHECK([[events.lastObject objectForKey:@"answerCode"] isEqual:@"E_INVALID_DATA"]);

  // After teardown a provider the pasteboard still holds answers nothing, without asking JavaScript.
  Perform(@"writePromised", @{ @"id": @"p4", @"types": @[@"text"], @"timeoutMs": @2000 });
  [events removeAllObjects];
  [clipboard invalidate];
  start = NSDate.date;
  CHECK([board stringForType:NSPasteboardTypeString] == nil && -start.timeIntervalSinceNow < 0.5 && EventsOfType(@"clipboardProvide").count == 0);
  CHECK(!Perform(@"writePromised", @{ @"id": @"p5", @"types": @[@"text"], @"timeoutMs": @100 }, &code) && [code isEqual:@"E_CLOSED"]);
}

static void Monitoring(NSPasteboard *board) {
  NSString *code;
  CHECK(!Perform(@"observe", @{ @"id": @"a", @"intervalMs": @50 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!Perform(@"observe", @{ @"id": @"a", @"intervalMs": @20000 }, &code) && [code isEqual:@"E_INVALID_ARGUMENT"]);
  [board clearContents];
  Perform(@"observe", @{ @"id": @"a", @"intervalMs": @100 });
  // Existing contents are not a change.
  Spin(0.3);
  CHECK(EventsOfType(@"clipboardChanged").count == 0);
  [board clearContents]; [board setString:@"another app" forType:NSPasteboardTypeString];
  Spin(0.3);
  NSArray *changed = EventsOfType(@"clipboardChanged");
  // Changes between two polls arrive as one event with the latest count.
  CHECK(changed.count == 1 && [changed[0][@"changeCount"] integerValue] == board.changeCount);
  // A second registration shares the timer; removing one keeps polling for the other.
  Perform(@"observe", @{ @"id": @"b", @"intervalMs": @5000 });
  Perform(@"unobserve", @{ @"id": @"a" });
  [board clearContents];
  Spin(0.3);
  CHECK(EventsOfType(@"clipboardChanged").count == 1); // b polls every 5 s
  Perform(@"unobserve", @{ @"id": @"b" });
  [board clearContents];
  Spin(0.3);
  CHECK(EventsOfType(@"clipboardChanged").count == 1);
  // Removing an unknown registration is harmless (idempotent cleanup).
  CHECK(Perform(@"unobserve", @{ @"id": @"b" }) == NSNull.null);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSString *scenario = argc > 1 ? @(argv[1]) : @"";
    NSInteger general = NSPasteboard.generalPasteboard.changeCount; // the count only; the contents are never read
    NSPasteboard *board = [NSPasteboard pasteboardWithUniqueName];
    events = [NSMutableArray new];
    // Answers promised-data requests from another thread, as JavaScript does while the main thread waits.
    clipboard = [[SparkClipboard alloc] initWithPasteboard:board emit:^(NSDictionary *event) {
      CHECK(NSThread.isMainThread);
      [events addObject:event];
      id (^answer)(NSDictionary *) = answerWith;
      if (![event[@"type"] isEqual:@"clipboardProvide"] || !answer) return;
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        id data = answer(event);
        if (!data) return;
        NSError *error = nil;
        if (![clipboard answer:[event[@"requestId"] integerValue] data:data == NSNull.null ? nil : data error:&error])
          dispatch_async(dispatch_get_main_queue(), ^{ [events addObject:@{ @"type": @"answerFailed", @"answerCode": error.userInfo[@"code"] ?: @"" }]; });
      });
    }];
    CHECK(clipboard.pasteboard == board && board != NSPasteboard.generalPasteboard);
    if ([scenario isEqual:@"operations"]) Operations(board);
    else if ([scenario isEqual:@"promised"]) Promised(board);
    else if ([scenario isEqual:@"monitoring"]) Monitoring(board);
    else { fprintf(stderr, "unknown scenario\n"); return 2; }
    [clipboard invalidate];
    [board releaseGlobally];
    CHECK(NSPasteboard.generalPasteboard.changeCount == general);
    if (failures) return 1;
    printf("PASS %s\n", scenario.UTF8String);
  }
  return 0;
}
