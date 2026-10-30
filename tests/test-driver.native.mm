#import <AppKit/AppKit.h>
#import "SparkTestDriver.h"
#include <atomic>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

// Usage: test-driver <mode> <parent>. Each mode is one app launch with a fresh run directory in <parent>.
static NSString *directory;
static NSMutableArray<NSURL *> *openedURLs;
static BOOL terminateRequested = NO;
static std::atomic<bool> mounting{false};
static NSDictionary *probeFrame; // waitFor's frame for probe-layer: points from the top-left of the captured frame view.
static const char *token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

@interface Delegate : NSObject <NSApplicationDelegate>
@end
@implementation Delegate
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls { [openedURLs addObjectsFromArray:urls]; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { terminateRequested = YES; return NSTerminateCancel; }
@end
@interface PointerWindow : NSWindow
@property BOOL shrinkOnOrder;
@end
@implementation PointerWindow
- (void)makeKeyAndOrderFront:(id)sender {
  [super makeKeyAndOrderFront:sender];
  if (self.shrinkOnOrder) { self.shrinkOnOrder = NO; [self setContentSize:NSMakeSize(200, 300)]; }
}
@end
@interface DrawnView : NSView
@end
@implementation DrawnView
- (void)drawRect:(NSRect)rect { [NSColor.greenColor setFill]; NSRectFill(self.bounds); }
@end

static void Check(BOOL condition, NSString *message) {
  if (!condition) { fprintf(stderr, "FAILED: %s\n", message.UTF8String); exit(1); }
}
static void Pump(BOOL (^done)(void), NSTimeInterval timeout) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
  while (!done() && deadline.timeIntervalSinceNow > 0) [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}
static void PrepareDirectory(const char *parent, mode_t directoryMode, mode_t tokenMode) {
  char path[PATH_MAX];
  snprintf(path, sizeof path, "%s/run-XXXXXX", parent);
  Check(mkdtemp(path) != NULL, @"mkdtemp");
  directory = @(path);
  NSString *file = [directory stringByAppendingPathComponent:@"token"];
  int fd = open(file.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL, 0600);
  Check(fd >= 0 && write(fd, token, strlen(token)) == (ssize_t)strlen(token) && close(fd) == 0, @"token");
  chmod(file.fileSystemRepresentation, tokenMode);
  chmod(path, directoryMode);
  setenv("SPARK_TEST_DRIVER_DIR", path, 1);
}
static int Connect(void) {
  struct sockaddr_un address = {};
  address.sun_family = AF_UNIX;
  strlcpy(address.sun_path, [directory stringByAppendingPathComponent:@"driver.sock"].fileSystemRepresentation, sizeof address.sun_path);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  Check(fd >= 0 && connect(fd, (struct sockaddr *)&address, sizeof address) == 0, @"connect");
  return fd;
}
static void SendRaw(int fd, NSString *text) {
  const char *bytes = text.UTF8String;
  Check(send(fd, bytes, strlen(bytes), 0) == (ssize_t)strlen(bytes), @"send");
}
static NSMutableData *pending;
static NSDictionary *Receive(int fd) {
  for (;;) {
    const char *bytes = (const char *)pending.bytes;
    const char *newline = (const char *)memchr(bytes, '\n', pending.length);
    if (newline) {
      NSData *line = [pending subdataWithRange:NSMakeRange(0, newline - bytes)];
      [pending replaceBytesInRange:NSMakeRange(0, newline - bytes + 1) withBytes:NULL length:0];
      return [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
    }
    char chunk[4096];
    ssize_t count = recv(fd, chunk, sizeof chunk, 0);
    if (count <= 0) return nil;
    [pending appendBytes:chunk length:count];
  }
}
static NSDictionary *Request(int fd, NSDictionary *request) {
  static int next = 0;
  NSMutableDictionary *message = [request mutableCopy];
  message[@"id"] = @(++next);
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  SendRaw(fd, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
  SendRaw(fd, @"\n");
  NSDictionary *reply = Receive(fd);
  Check([reply[@"id"] isEqual:message[@"id"]], [NSString stringWithFormat:@"reply id for %@: %@", request, reply]);
  return reply;
}
static NSString *Code(NSDictionary *reply) { return reply[@"error"][@"code"]; }
static void Client(void (^body)(void)) { [NSThread detachNewThreadWithBlock:body]; }

static NSWindow *MakeWindow(void) {
  NSWindow *window = [[PointerWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  window.identifier = @"spark.main"; window.title = @"Probe"; window.releasedWhenClosed = NO;
  NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 400, 300)];
  content.wantsLayer = YES; content.layer.backgroundColor = NSColor.whiteColor.CGColor;
  // Each region samples one rendering path, top-left to bottom-right (AppKit is y-up).
  NSView *layerColor = [[NSView alloc] initWithFrame:NSMakeRect(0, 200, 100, 100)];
  layerColor.wantsLayer = YES; layerColor.layer.backgroundColor = NSColor.redColor.CGColor;
  layerColor.accessibilityIdentifier = @"probe-layer";
  DrawnView *drawn = [[DrawnView alloc] initWithFrame:NSMakeRect(100, 200, 100, 100)];
  NSView *image = [[NSView alloc] initWithFrame:NSMakeRect(200, 200, 100, 100)];
  image.wantsLayer = YES;
  NSImage *blue = [NSImage imageWithSize:NSMakeSize(10, 10) flipped:NO drawingHandler:^BOOL(NSRect rect) { [NSColor.blueColor setFill]; NSRectFill(rect); return YES; }];
  image.layer.contents = (__bridge id)[blue CGImageForProposedRect:NULL context:nil hints:nil];
  NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(300, 200, 100, 100)];
  effect.material = NSVisualEffectMaterialHUDWindow; effect.blendingMode = NSVisualEffectBlendingModeBehindWindow; effect.state = NSVisualEffectStateActive;
  NSButton *button = [NSButton buttonWithTitle:@"Native button" target:nil action:nil];
  button.frame = NSMakeRect(20, 100, 160, 32);
  NSTextField *label = [NSTextField labelWithString:@"Label"];
  label.frame = NSMakeRect(220, 100, 160, 32); label.font = [NSFont systemFontOfSize:28];
  for (NSView *view in @[layerColor, drawn, image, effect, button, label]) [content addSubview:view];
  window.contentView = content;
  return window;
}
// Samples the center of a content-view rect (points, y-up) in a PNG written by the driver.
static NSColor *Sample(NSString *file, NSRect rect, NSWindow *window) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep imageRepWithData:[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:file]]]
    bitmapImageRepByConvertingToColorSpace:NSColorSpace.sRGBColorSpace renderingIntent:NSColorRenderingIntentDefault];
  CGFloat scale = rep.pixelsWide / window.frame.size.width;
  NSPoint center = [window.contentView convertPoint:NSMakePoint(NSMidX(rect), NSMidY(rect)) toView:nil];
  NSInteger x = lround(center.x * scale), y = lround((window.frame.size.height - center.y) * scale);
  return [rep colorAtX:x y:y];
}
// Samples a point given in captured-frame points from the top-left, as waitFor reports frames.
static NSColor *SampleTopLeft(NSString *file, CGFloat x, CGFloat y, CGFloat scale) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep imageRepWithData:[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:file]]]
    bitmapImageRepByConvertingToColorSpace:NSColorSpace.sRGBColorSpace renderingIntent:NSColorRenderingIntentDefault];
  return [rep colorAtX:lround(x * scale) y:lround(y * scale)];
}
static BOOL Near(NSColor *color, CGFloat r, CGFloat g, CGFloat b) {
  return fabs(color.redComponent - r) < 0.1 && fabs(color.greenComponent - g) < 0.1 && fabs(color.blueComponent - b) < 0.1;
}
static NSString *Describe(NSColor *color) { return [NSString stringWithFormat:@"%.2f,%.2f,%.2f", color.redComponent, color.greenComponent, color.blueComponent]; }

int main(int argc, char **argv) { @autoreleasepool {
  NSString *mode = argc > 1 ? @(argv[1]) : @"";
  openedURLs = [NSMutableArray new]; pending = [NSMutableData new];
  [NSApplication sharedApplication];
  Delegate *delegate = [Delegate new]; NSApp.delegate = delegate;
  if ([mode isEqual:@"inert"]) {
    unsetenv("SPARK_TEST_DRIVER_DIR");
    Check(!SparkTestDriverStart() && !SparkTestDriverActive(), @"driver starts without the runner");
    puts("inert passed"); return 0;
  }
  if ([mode isEqual:@"refuse-directory"]) { PrepareDirectory(argv[2], 0755, 0600); SparkTestDriverStart(); return 0; }
  if ([mode isEqual:@"refuse-token"]) { PrepareDirectory(argv[2], 0700, 0644); SparkTestDriverStart(); return 0; }
  PrepareDirectory(argv[2], 0700, 0600);
  NSWindow *window = MakeWindow();
  Check(SparkTestDriverStart() && SparkTestDriverActive(), @"driver start");
  // Optional modules add commands; built-in and duplicate names are refused.
  SparkTestDriverRegisterCommand(@"echo", ^(NSDictionary *request, SparkTestDriverReply reply) { reply(@{ @"ok": @YES, @"echo": request[@"value"] ?: NSNull.null }); });
  for (NSString *taken in @[@"ping", @"openFile", @"pointerEvents", @"restorePointer", @"echo"]) {
    BOOL refused = NO;
    @try { SparkTestDriverRegisterCommand(taken, ^(NSDictionary *, SparkTestDriverReply reply) { reply(@{ @"ok": @NO }); }); } @catch (NSException *) { refused = YES; }
    Check(refused, [NSString stringWithFormat:@"%@ cannot be registered twice", taken]);
  }
  SparkTestDriverDidMount(); // The host's first UI mount.
  Check(!getenv("SPARK_TEST_DRIVER_DIR"), @"driver mode is not inherited by child processes");
  Check(access([directory stringByAppendingPathComponent:@"token"].fileSystemRepresentation, F_OK) != 0, @"token is one-time");
  struct stat info;
  Check(lstat([directory stringByAppendingPathComponent:@"driver.sock"].fileSystemRepresentation, &info) == 0 && S_ISSOCK(info.st_mode) && (info.st_mode & 0777) == 0600, @"socket is 0600");
  Check(NSApp.activationPolicy == NSApplicationActivationPolicyProhibited, @"driver mode cannot activate");
  __block BOOL finished = NO;

  if ([mode isEqual:@"auth"]) Client(^{
    int fd = Connect();
    SendRaw(fd, @"{\"token\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeX\"}\n");
    Check([Code(Receive(fd)) isEqual:@"E_AUTH"], @"wrong token is rejected");
    Check(Receive(fd) == nil, @"rejected client is disconnected");
    finished = YES;
  });
  else if ([mode isEqual:@"disconnect"]) Client(^{
    int fd = Connect();
    SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
    Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
    // The reply arrives after the client is gone: SO_NOSIGPIPE must keep the app alive.
    SendRaw(fd, @"{\"id\":1,\"command\":\"waitFor\",\"testID\":\"missing\",\"timeoutMs\":300}\n");
    close(fd);
    finished = YES;
  });
  else if ([mode isEqual:@"pointer-disconnect"]) Client(^{
    int fd = Connect();
    SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
    Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
    if (NSScreen.screens.count)
      Check([Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": @50, @"y": @60 })[@"ok"] boolValue], @"pointer before disconnect");
    close(fd);
    finished = YES;
  });
  else if ([mode isEqual:@"session"]) Client(^{
    int fd = Connect();
    // Split writes exercise partial reads on the accepted socket.
    SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%.10s", token]);
    usleep(100000);
    SendRaw(fd, [NSString stringWithFormat:@"%s\"}\n", token + 10]);
    NSDictionary *hello = Receive(fd);
    Check([hello[@"ok"] boolValue] && [hello[@"protocol"] isEqual:@1], @"authenticated");
    Check([Request(fd, @{ @"command": @"ping" })[@"ok"] boolValue], @"ping");
    Check([Code(Request(fd, @{ @"command": @"fly" })) isEqual:@"E_UNKNOWN_COMMAND"], @"unknown command");
    Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"id:missing", @"x": @10, @"y": @20 })) isEqual:@"E_NO_WINDOW"], @"pointer requires an existing window");
    Check([Request(fd, @{ @"command": @"navigate", @"url": @"spark-ks://windows/frame" })[@"ok"] boolValue], @"navigate");
    Check([Code(Request(fd, @{ @"command": @"navigate", @"url": @"file:///etc/hosts" })) isEqual:@"E_INVALID_ARGUMENT"], @"file URLs are not navigation");
    Check([Request(fd, @{ @"command": @"openFile", @"path": @"/etc/hosts" })[@"ok"] boolValue], @"openFile");
    Check([Code(Request(fd, @{ @"command": @"openFile", @"path": @"etc/hosts" })) isEqual:@"E_INVALID_ARGUMENT"], @"openFile needs an absolute path");
    Check([Code(Request(fd, @{ @"command": @"openFile", @"path": @"/etc/spark-driver-missing" })) isEqual:@"E_NOT_FOUND"], @"openFile needs an existing file");
    NSDictionary *found = Request(fd, @{ @"command": @"waitFor", @"testID": @"probe-layer" });
    Check([found[@"ok"] boolValue] && [found[@"frame"][@"width"] isEqual:@100] && [found[@"window"] isEqual:@"spark.main"], @"waitFor finds an existing view");
    probeFrame = found[@"frame"];
    Check([Code(Request(fd, @{ @"command": @"waitFor", @"testID": @"missing", @"timeoutMs": @100 })) isEqual:@"E_TIMEOUT"], @"waitFor times out");
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      NSView *late = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)]; late.accessibilityIdentifier = @"late";
      [window.contentView addSubview:late];
    });
    Check([Request(fd, @{ @"command": @"waitFor", @"testID": @"late", @"timeoutMs": @2000 })[@"ok"] boolValue], @"waitFor sees views mounted later");
    dispatch_sync(dispatch_get_main_queue(), ^{ NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua]; });
    NSDictionary *light = Request(fd, @{ @"command": @"setAppAppearance", @"appearance": @"light" });
    Check([light[@"ok"] boolValue] && [light[@"changed"] isEqual:@NO], @"an unchanged appearance replies at once");
    Check([Code(Request(fd, @{ @"command": @"setAppAppearance", @"appearance": @"dark", @"timeoutMs": @200 })) isEqual:@"E_TIMEOUT"], @"an appearance change with no UI update fails");
    dispatch_sync(dispatch_get_main_queue(), ^{ NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua]; });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ SparkTestDriverDidMount(); });
    NSDictionary *dark = Request(fd, @{ @"command": @"setAppAppearance", @"appearance": @"dark" });
    Check([dark[@"ok"] boolValue] && [dark[@"changed"] boolValue], @"dark appearance waits for the UI update");
    Request(fd, @{ @"command": @"setAppAppearance", @"appearance": @"light", @"timeoutMs": @0 });
    // Captures wait for mounts to settle.
    mounting = true;
    dispatch_sync(dispatch_get_main_queue(), ^{
      SparkTestDriverDidMount();
      [NSTimer scheduledTimerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) { if (mounting) SparkTestDriverDidMount(); else [timer invalidate]; }];
    });
    Check([Code(Request(fd, @{ @"command": @"capture", @"window": @"main", @"name": @"busy", @"timeoutMs": @200 })) isEqual:@"E_NOT_SETTLED"], @"capture waits for mounts to settle");
    Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": @50, @"y": @60, @"timeoutMs": @200 })) isEqual:@"E_NOT_SETTLED"], @"pointer input waits for mounts and gesture attachment to settle");
    Check(!window.isVisible && NSApp.activationPolicy == NSApplicationActivationPolicyProhibited, @"unsettled pointer input never shows or activates the app");
    Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"id:missing", @"x": @10, @"y": @20, @"timeoutMs": @200 })) isEqual:@"E_NO_WINDOW"], @"pointer resolves its window before waiting");
    Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": @"bad", @"y": @20, @"timeoutMs": @200 })) isEqual:@"E_INVALID_ARGUMENT"], @"pointer validates its point before waiting");
    mounting = false;
    NSDictionary *capture = Request(fd, @{ @"command": @"capture", @"window": @"main", @"name": @"cache" });
    Check([capture[@"ok"] boolValue] && [capture[@"file"] isEqual:@"cache.png"], [NSString stringWithFormat:@"capture %@", capture]);
    Check([capture[@"width"] doubleValue] == window.frame.size.width * [capture[@"scale"] doubleValue], @"capture covers the window frame including the title bar");
    struct stat file;
    Check(stat([directory stringByAppendingPathComponent:@"cache.png"].fileSystemRepresentation, &file) == 0 && (file.st_mode & 0777) == 0600, @"capture is private");
    Check([Code(Request(fd, @{ @"command": @"capture", @"window": @"main", @"name": @"cache" })) isEqual:@"E_IO"], @"captures never overwrite");
    Check([Code(Request(fd, @{ @"command": @"capture", @"window": @"main", @"name": @"../escape" })) isEqual:@"E_INVALID_ARGUMENT"], @"capture names cannot leave the run directory");
    Check([Code(Request(fd, @{ @"command": @"capture", @"window": @"key", @"name": @"key" })) isEqual:@"E_NO_WINDOW"], @"driver-mode apps have no key window");
    Check([Code(Request(fd, @{ @"command": @"capture", @"window": @"id:nope", @"name": @"nope" })) isEqual:@"E_NO_WINDOW"], @"unknown windows fail");
    NSDictionary *byTitle = Request(fd, @{ @"command": @"capture", @"window": @"title:Probe", @"name": @"title" });
    Check([byTitle[@"ok"] boolValue], @"capture by title");
    // Two requests in one write are answered in order.
    SendRaw(fd, @"{\"id\":\"a\",\"command\":\"ping\"}\n{\"id\":\"b\",\"command\":\"ping\"}\n");
    Check([Receive(fd)[@"id"] isEqual:@"a"] && [Receive(fd)[@"id"] isEqual:@"b"], @"pipelined requests");
    if (NSScreen.screens.count) {
      dispatch_sync(dispatch_get_main_queue(), ^{
        [window setFrameOrigin:NSMakePoint(100, 150)];
      });
      NSWindowAnimationBehavior animation = window.animationBehavior;
      int64_t previousNumber = 0;
      for (int tap = 0; tap < 2; tap++) {
        NSDictionary *pointer = Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": @50, @"y": @60 });
        Check([pointer[@"ok"] boolValue], [NSString stringWithFormat:@"pointer window geometry: %@", pointer]);
        int64_t downNumber = 0;
        for (NSString *key in @[@"down", @"up"]) {
          NSData *data = [[NSData alloc] initWithBase64EncodedString:pointer[key] options:0];
          CGEventRef event = CGEventCreateFromData(NULL, (__bridge CFDataRef)data);
          Check(event != NULL, @"pointer event data decodes");
          NSEvent *mouse = [NSEvent eventWithCGEvent:event];
          CGPoint screen = CGEventGetLocation(event);
          Check(mouse.windowNumber == window.windowNumber && fabs(mouse.locationInWindow.x - 50) < 1 && fabs(mouse.locationInWindow.y - (NSHeight(window.frame) - 60)) < 1, [NSString stringWithFormat:@"encoded events preserve the window and AppKit-local hit point: %@ global=%@ frame=%@", NSStringFromPoint(mouse.locationInWindow), NSStringFromPoint(NSPointFromCGPoint(screen)), NSStringFromRect(window.frame)]);
          Check(fabs(screen.x - (NSMinX(window.frame) + 50)) < 0.1 && fabs(screen.y - (NSMaxY(NSScreen.screens.firstObject.frame) - NSMaxY(window.frame) + 60)) < 0.1, @"encoded events preserve Quartz screen coordinates");
          Check(CGEventGetType(event) == ([key isEqual:@"down"] ? kCGEventLeftMouseDown : kCGEventLeftMouseUp), @"pointer encodes mouse down then up");
          int64_t number = CGEventGetIntegerValueField(event, kCGMouseEventNumber);
          if ([key isEqual:@"down"]) {
            Check(number > previousNumber, @"each tap gets a monotonic event number");
            downNumber = number;
          } else Check(number == downNumber, @"down and up share kCGMouseEventNumber after serialization");
          CFRelease(event);
        }
        previousNumber = downNumber;
        Check([pointer[@"pid"] intValue] == getpid(), @"pointer events target the owning process");
        Check(window.isVisible, @"pointerEvents explicitly shows the hidden window");
      }
      for (id x in @[@-1, @400, @"bad", NSNull.null])
        Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": x, @"y": @20 })) isEqual:@"E_INVALID_ARGUMENT"], @"pointer coordinates must be inside the frame");
      dispatch_sync(dispatch_get_main_queue(), ^{ ((PointerWindow *)window).shrinkOnOrder = YES; });
      Check([Code(Request(fd, @{ @"command": @"pointerEvents", @"window": @"main", @"x": @350, @"y": @20 })) isEqual:@"E_INVALID_ARGUMENT"], @"pointer bounds use geometry after ordering and layout");
      dispatch_sync(dispatch_get_main_queue(), ^{ [window setContentSize:NSMakeSize(400, 300)]; });
      Check([Request(fd, @{ @"command": @"restorePointer" })[@"ok"] boolValue], @"restore pointer state");
      dispatch_sync(dispatch_get_main_queue(), ^{
        Check(!window.isVisible && !NSApp.keyWindow, @"pointer cleanup hides the window");
        Check(NSApp.activationPolicy == NSApplicationActivationPolicyProhibited, @"pointer cleanup restores prohibited activation");
        Check(window.animationBehavior == animation, @"pointer cleanup restores animation");
      });
      Check([Request(fd, @{ @"command": @"restorePointer" })[@"ok"] boolValue], @"pointer cleanup is idempotent");
    } else puts("pointer geometry skipped: no display");
    Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
    Check(Receive(fd) == nil, @"quit ends the session");
    finished = YES;
  });
  else Check(NO, [@"unknown mode " stringByAppendingString:mode]);

  Pump(^{ return (BOOL)(finished && terminateRequested); }, 20);
  Check(finished, @"client finished");
  Check(terminateRequested, @"the app quits when the session ends");
  if ([mode isEqual:@"pointer-disconnect"]) {
    Check(!window.isVisible, @"disconnect hides the pointer window before termination");
    Check(NSApp.activationPolicy == NSApplicationActivationPolicyProhibited, @"disconnect restores activation before termination");
  }
  Pump(^{ return (BOOL)(access([directory stringByAppendingPathComponent:@"driver.sock"].fileSystemRepresentation, F_OK) != 0); }, 2);
  Check(access([directory stringByAppendingPathComponent:@"driver.sock"].fileSystemRepresentation, F_OK) != 0, @"socket is removed");
  if ([mode isEqual:@"session"]) {
    Check(openedURLs.count == 2 && [openedURLs[0].absoluteString isEqual:@"spark-ks://windows/frame"], @"navigate opens the URL through the app delegate");
    Check(openedURLs[1].isFileURL && [openedURLs[1].path isEqual:@"/etc/hosts"], @"openFile opens a file URL through the app delegate");
    // A window that was never shown renders everything drawn in-process.
    Check(Near(Sample(@"cache.png", NSMakeRect(0, 200, 100, 100), window), 1, 0, 0), @"capture renders layer background colors");
    CGFloat scale = [[NSBitmapImageRep imageRepWithData:[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"cache.png"]]] pixelsWide] / window.frame.size.width;
    NSColor *atFrame = SampleTopLeft(@"cache.png", [probeFrame[@"x"] doubleValue] + 50, [probeFrame[@"y"] doubleValue] + 50, scale);
    Check(Near(atFrame, 1, 0, 0) && [probeFrame[@"y"] doubleValue] < window.frame.size.height - 200 - 100 + 1,
      [NSString stringWithFormat:@"waitFor frames are top-left points of the captured area (%@ sampled %@)", probeFrame, Describe(atFrame)]);
    Check(Near(Sample(@"cache.png", NSMakeRect(100, 200, 100, 100), window), 0, 1, 0), @"capture renders drawRect content");
    Check(Near(Sample(@"cache.png", NSMakeRect(200, 200, 100, 100), window), 0, 0, 1), @"capture renders layer contents");
    // Behind-window blur comes from the window server; in-process it is a flat material color.
    NSColor *vibrancy = Sample(@"cache.png", NSMakeRect(300, 200, 100, 100), window);
    printf("behind-window vibrancy renders as %s\n", Describe(vibrancy).UTF8String);
  }
  [NSFileManager.defaultManager removeItemAtPath:directory error:nil];
  printf("%s passed\n", mode.UTF8String);
  return 0;
} }
