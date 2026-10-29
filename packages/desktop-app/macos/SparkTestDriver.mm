#import "SparkTestDriver.h"
#import <CoreGraphics/CoreGraphics.h>
#import <QuartzCore/QuartzCore.h>
#include <atomic>
#include <fcntl.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

// Protocol: newline-delimited JSON over a Unix socket in the run directory. The
// first message is {"token": "..."}; then one request at a time, each answered
// with {"id", "ok", ...} or {"id", "ok": false, "error": {"code", "message"}}.
typedef void (^SparkDriverReply)(NSDictionary *reply);
static BOOL active = NO, ending = NO;
static int directoryFD = -1, listenFD = -1;
static NSString *socketPath;
static NSData *token;
static id activity;
static NSMutableArray<dispatch_block_t> *pointerRestores;
static NSInteger pointerEventNumber = 0;
static std::atomic<bool> authenticated{false};
static CFTimeInterval lastMount = 0;
static const CFTimeInterval SparkSettleInterval = 0.1;
static const NSUInteger SparkMaxMessage = 1 << 20;

static void SparkDriverRefuse(NSString *message) {
  NSLog(@"Spark test driver: %@", message);
  exit(78); // EX_CONFIG: the runner's launch contract was violated.
}
static void SparkDriverTerminate(void) { ending = YES; [NSApp terminate:nil]; }
BOOL SparkTestDriverActive(void) { return active; }
BOOL SparkTestDriverEnding(void) { return ending; }
void SparkTestDriverDidMount(void) { lastMount = CACurrentMediaTime(); }
static NSArray<NSString *> *const SparkBuiltInCommands = @[@"ping", @"navigate", @"openFile", @"waitFor", @"setAppAppearance", @"capture", @"pointerEvents", @"restorePointer", @"quit"];
static NSMutableDictionary<NSString *, SparkTestDriverHandler> *SparkModuleCommands(void) {
  static NSMutableDictionary *commands;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ commands = [NSMutableDictionary new]; });
  return commands;
}
void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler) {
  NSCAssert(NSThread.isMainThread, @"Driver commands are registered on the main thread");
  if ([SparkBuiltInCommands containsObject:name] || SparkModuleCommands()[name]) [NSException raise:NSInvalidArgumentException format:@"Driver command %@ is already defined", name];
  SparkModuleCommands()[name] = [handler copy];
}

static BOOL SparkPrivate(int fd, mode_t type, mode_t mode) {
  struct stat info;
  return fstat(fd, &info) == 0 && (info.st_mode & S_IFMT) == type && info.st_uid == getuid() && (info.st_mode & 0777) == mode;
}
static NSData *SparkConsumeToken(void) {
  int fd = openat(directoryFD, "token", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return nil;
  struct stat info;
  NSMutableData *data = nil;
  if (SparkPrivate(fd, S_IFREG, 0600) && fstat(fd, &info) == 0 && info.st_size >= 32 && info.st_size <= 256) {
    data = [NSMutableData dataWithLength:(NSUInteger)info.st_size];
    if (read(fd, data.mutableBytes, data.length) != (ssize_t)data.length) data = nil;
  }
  close(fd);
  // One-time: nothing else can read the token after launch.
  return data && unlinkat(directoryFD, "token", 0) == 0 ? data : nil;
}
static int SparkListen(NSString *path) {
  struct sockaddr_un address = {};
  address.sun_family = AF_UNIX;
  if (strlcpy(address.sun_path, path.fileSystemRepresentation, sizeof address.sun_path) >= sizeof address.sun_path) return -1;
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  // Nothing can connect before listen(), so tightening the mode after bind() is race-free.
  if (fcntl(fd, F_SETFD, FD_CLOEXEC) != 0 || bind(fd, (struct sockaddr *)&address, sizeof address) != 0 ||
      chmod(address.sun_path, 0600) != 0 || listen(fd, 1) != 0) { close(fd); return -1; }
  return fd;
}

static NSData *SparkReadLine(int fd, NSMutableData *buffer) {
  for (;;) {
    const char *bytes = (const char *)buffer.bytes;
    const char *newline = (const char *)memchr(bytes, '\n', buffer.length);
    if (newline) {
      NSUInteger length = (NSUInteger)(newline - bytes);
      NSData *line = [buffer subdataWithRange:NSMakeRange(0, length)];
      [buffer replaceBytesInRange:NSMakeRange(0, length + 1) withBytes:NULL length:0];
      return line;
    }
    if (buffer.length > SparkMaxMessage) return nil;
    char chunk[4096];
    ssize_t count = recv(fd, chunk, sizeof chunk, 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return nil; // EOF, error, or the authentication timeout.
    [buffer appendBytes:chunk length:(NSUInteger)count];
  }
}
static BOOL SparkSend(int fd, NSDictionary *message) {
  NSMutableData *data = [[NSJSONSerialization dataWithJSONObject:message options:0 error:nil] mutableCopy];
  [data appendBytes:"\n" length:1];
  const char *bytes = (const char *)data.bytes;
  size_t remaining = data.length;
  while (remaining) {
    ssize_t count = send(fd, bytes, remaining, 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return NO;
    bytes += count; remaining -= (size_t)count;
  }
  return YES;
}
static NSDictionary *SparkFailure(NSString *code, NSString *message) {
  return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } };
}

static void SparkWaitUntil(NSTimeInterval timeout, BOOL (^ready)(void), void (^done)(BOOL ready)) {
  if (ready()) { done(YES); return; }
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
  NSTimer *timer = [NSTimer timerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) {
    BOOL now = ready();
    if (!now && deadline.timeIntervalSinceNow > 0) return;
    [timer invalidate]; done(now);
  }];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}
static BOOL SparkSettled(void) { return CACurrentMediaTime() - lastMount >= SparkSettleInterval; }
static NSTimeInterval SparkTimeout(id value, NSTimeInterval fallback) {
  return [value isKindOfClass:NSNumber.class] ? MIN(MAX([value doubleValue], 0), 120000) / 1000 : fallback;
}
static NSView *SparkFrameView(NSWindow *window) { return window.contentView.superview ?: window.contentView; }
static NSView *SparkFindTestID(NSView *view, NSString *testID) {
  if (view.isHidden) return nil;
  if ([view.accessibilityIdentifier isEqualToString:testID]) return view;
  for (NSView *child in view.subviews) {
    NSView *match = SparkFindTestID(child, testID);
    if (match) return match;
  }
  return nil;
}
static NSWindow *SparkResolveWindow(id target, NSString **failure) {
  if (![target isKindOfClass:NSString.class]) { *failure = @"Expected window: main, key, id:<identifier> or title:<title>"; return nil; }
  if ([target isEqual:@"key"]) {
    if (!NSApp.keyWindow) *failure = @"No key window. Driver-mode apps never activate; use main, id:<identifier> or title:<title>";
    return NSApp.keyWindow;
  }
  NSString *identifier = [target isEqual:@"main"] ? @"spark.main" : [target hasPrefix:@"id:"] ? [target substringFromIndex:3] : nil;
  NSString *title = [target hasPrefix:@"title:"] ? [target substringFromIndex:6] : nil;
  if (!identifier && !title) { *failure = @"Expected window: main, key, id:<identifier> or title:<title>"; return nil; }
  NSMutableArray<NSWindow *> *matches = [NSMutableArray new];
  for (NSWindow *window in NSApp.windows)
    if (identifier ? [window.identifier isEqualToString:identifier] : [window.title isEqualToString:title]) [matches addObject:window];
  if (matches.count != 1) { *failure = [NSString stringWithFormat:@"%lu windows match %@", (unsigned long)matches.count, target]; return nil; }
  return matches.firstObject;
}
static BOOL SparkCaptureName(id name) {
  if (![name isKindOfClass:NSString.class] || [name length] < 1 || [name length] > 100) return NO;
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"];
  return [name rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound && [name characterAtIndex:0] != '-';
}
// cacheDisplayInRect: draws the view tree, so it works for windows never shown on
// screen. CALayer rendering does not (docs/test-driver.md has the measurements).
static NSBitmapImageRep *SparkRender(NSView *view) {
  NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  return rep;
}
// Captures are created only inside the runner's private run directory.
static int SparkWriteCapture(NSString *file, NSData *data) {
  int fd = openat(directoryFD, file.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return errno;
  const char *bytes = (const char *)data.bytes;
  size_t remaining = data.length;
  int failure = 0;
  while (remaining && !failure) {
    ssize_t count = write(fd, bytes, remaining);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) failure = errno;
    else { bytes += count; remaining -= (size_t)count; }
  }
  if (close(fd) != 0 && !failure) failure = errno;
  if (failure) unlinkat(directoryFD, file.fileSystemRepresentation, 0);
  return failure;
}

static void SparkCapture(NSDictionary *request, SparkDriverReply reply) {
  NSString *failure = nil;
  NSWindow *window = SparkResolveWindow(request[@"window"], &failure);
  if (!window) { reply(SparkFailure(@"E_NO_WINDOW", failure)); return; }
  NSString *name = request[@"name"];
  if (!SparkCaptureName(name)) { reply(SparkFailure(@"E_INVALID_ARGUMENT", @"Capture names use 1-100 of [A-Za-z0-9_-] and do not start with -")); return; }
  SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 5), ^{ return SparkSettled(); }, ^(BOOL settled) {
    if (!settled) { reply(SparkFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
    NSView *view = SparkFrameView(window);
    [window layoutIfNeeded];
    [view displayIfNeeded];
    NSBitmapImageRep *rep = SparkRender(view);
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png) { reply(SparkFailure(@"E_RENDER", @"Rendering produced no image")); return; }
    NSString *file = [name stringByAppendingPathExtension:@"png"];
    int error = SparkWriteCapture(file, png);
    if (error) { reply(SparkFailure(@"E_IO", [NSString stringWithFormat:@"%@: %s", file, strerror(error)])); return; }
    reply(@{ @"ok": @YES, @"file": file, @"width": @(rep.pixelsWide), @"height": @(rep.pixelsHigh), @"scale": @(window.backingScaleFactor) });
  });
}
static void SparkSetAppearance(NSDictionary *request, SparkDriverReply reply) {
  NSString *value = request[@"appearance"];
  NSAppearanceName name = [value isEqual:@"dark"] ? NSAppearanceNameDarkAqua : [value isEqual:@"light"] ? NSAppearanceNameAqua : nil;
  if (!name) { reply(SparkFailure(@"E_INVALID_ARGUMENT", @"Appearance is light or dark")); return; }
  NSTimeInterval timeout = SparkTimeout(request[@"timeoutMs"], 10);
  // An override set while the app is still launching did not last (its first render came out in the OS
  // appearance), so it is applied once the first rendered UI has settled, as navigate waits too.
  SparkWaitUntil(timeout, ^{ return (BOOL)(lastMount > 0 && SparkSettled()); }, ^(BOOL launched) {
    if (!launched) { reply(SparkFailure(@"E_TIMEOUT", @"The app has not rendered")); return; }
    NSArray *names = @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua];
    BOOL changed = ![[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:names] isEqualToString:name];
    // The app-level override, independent of the OS setting; per-window overrides still win.
    NSApp.appearance = [NSAppearance appearanceNamed:name];
    if (!changed) { reply(@{ @"ok": @YES, @"changed": @NO }); return; }
    CFTimeInterval changedAt = CACurrentMediaTime();
    SparkWaitUntil(timeout, ^{ return (BOOL)(lastMount > changedAt && SparkSettled()); }, ^(BOOL rendered) {
      reply(rendered ? @{ @"ok": @YES, @"changed": @YES } : SparkFailure(@"E_TIMEOUT", @"No UI update followed the appearance change"));
    });
  });
}
// Deep links and files arrive through application:openURLs:, the path the OS uses for a
// clicked link or a file opened from Finder, once the first render has settled so the
// app's link and open-file listeners are subscribed.
static void SparkOpenURL(NSURL *url, NSDictionary *request, SparkDriverReply reply) {
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(application:openURLs:)]) { reply(SparkFailure(@"E_UNSUPPORTED", @"The application delegate does not open URLs")); return; }
  SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 30), ^{ return (BOOL)(lastMount > 0 && SparkSettled()); }, ^(BOOL rendered) {
    if (!rendered) { reply(SparkFailure(@"E_TIMEOUT", @"The app has not rendered")); return; }
    [delegate application:NSApp openURLs:@[url]];
    reply(@{ @"ok": @YES });
  });
}
static void SparkRestorePointer(void) {
  for (dispatch_block_t restore in pointerRestores.reverseObjectEnumerator) restore();
  pointerRestores = nil;
}
static void SparkPointerEvents(NSDictionary *request, SparkDriverReply reply) {
  NSString *failure = nil;
  NSWindow *window = SparkResolveWindow(request[@"window"], &failure);
  if (!window) { reply(SparkFailure(@"E_NO_WINDOW", failure)); return; }
  id x = request[@"x"], y = request[@"y"];
  if (![x isKindOfClass:NSNumber.class] || ![y isKindOfClass:NSNumber.class] ||
      !isfinite([x doubleValue]) || !isfinite([y doubleValue])) {
    reply(SparkFailure(@"E_INVALID_ARGUMENT", @"pointerEvents expects finite x,y")); return;
  }
  if (!pointerRestores) {
    pointerRestores = [NSMutableArray new];
    NSApplicationActivationPolicy policy = NSApp.activationPolicy;
    NSRunningApplication *previous = NSWorkspace.sharedWorkspace.frontmostApplication;
    [pointerRestores addObject:[^{
      [NSApp setActivationPolicy:policy];
      if (previous.processIdentifier != getpid()) [previous activateWithOptions:0];
    } copy]];
    if (policy == NSApplicationActivationPolicyProhibited) [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  }
  // Pointer input opts into foreground clicks; ordinary driver windows stay hidden.
  if (!window.isVisible) {
    NSWindowAnimationBehavior animation = window.animationBehavior;
    [pointerRestores addObject:[^{ [window orderOut:nil]; window.animationBehavior = animation; } copy]];
    window.animationBehavior = NSWindowAnimationBehaviorNone;
  }
  [window makeKeyAndOrderFront:nil];
  if (!NSApp.isActive) [NSApp activateIgnoringOtherApps:YES];
  [window layoutIfNeeded];
  NSView *root = SparkFrameView(window);
  if ([x doubleValue] < 0 || [y doubleValue] < 0 || [x doubleValue] >= NSWidth(root.bounds) || [y doubleValue] >= NSHeight(root.bounds)) {
    reply(SparkFailure(@"E_INVALID_ARGUMENT", @"pointerEvents expects x,y inside the captured window frame (top-left points)")); return;
  }
  NSPoint local = NSMakePoint(NSMinX(root.bounds) + [x doubleValue], root.isFlipped ? NSMinY(root.bounds) + [y doubleValue] : NSMaxY(root.bounds) - [y doubleValue]);
  NSPoint windowPoint = [root convertPoint:local toView:nil];
  NSMutableArray<NSString *> *events = [NSMutableArray new];
  NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  NSInteger eventNumber = ++pointerEventNumber;
  for (NSUInteger i = 0; i < 2; i++) {
    NSEvent *event = [NSEvent mouseEventWithType:i == 0 ? NSEventTypeLeftMouseDown : NSEventTypeLeftMouseUp location:windowPoint modifierFlags:0 timestamp:now + i * 0.05 windowNumber:window.windowNumber context:nil eventNumber:eventNumber clickCount:1 pressure:i == 0 ? 1 : 0];
    NSData *data = event.CGEvent ? CFBridgingRelease(CGEventCreateData(NULL, event.CGEvent)) : nil;
    if (!data) { reply(SparkFailure(@"E_EVENT", @"Could not encode mouse events for the target window")); return; }
    [events addObject:[data base64EncodedStringWithOptions:0]];
  }
  reply(@{ @"ok": @YES, @"pid": @(getpid()), @"down": events[0], @"up": events[1] });
}
static void SparkExecute(NSDictionary *request, SparkDriverReply reply) {
  NSString *command = request[@"command"];
  if ([command isEqual:@"ping"]) reply(@{ @"ok": @YES });
  else if ([command isEqual:@"navigate"]) {
    NSURL *url = [request[@"url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:request[@"url"]] : nil;
    if (!url.scheme.length || url.isFileURL) { reply(SparkFailure(@"E_INVALID_ARGUMENT", @"navigate expects a non-file URL; open files with openFile")); return; }
    SparkOpenURL(url, request, reply);
  }
  else if ([command isEqual:@"openFile"]) {
    NSString *path = request[@"path"];
    if (![path isKindOfClass:NSString.class] || !path.isAbsolutePath) { reply(SparkFailure(@"E_INVALID_ARGUMENT", @"openFile expects an absolute path")); return; }
    BOOL directory = NO;
    if (![NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&directory]) { reply(SparkFailure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No file at %@", path])); return; }
    SparkOpenURL([NSURL fileURLWithPath:path isDirectory:directory], request, reply);
  }
  else if ([command isEqual:@"waitFor"]) {
    NSString *testID = request[@"testID"];
    if (![testID isKindOfClass:NSString.class] || !testID.length) { reply(SparkFailure(@"E_INVALID_ARGUMENT", @"waitFor expects testID")); return; }
    __block NSView *match = nil;
    SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 10), ^{
      for (NSWindow *window in NSApp.windows) if ((match = SparkFindTestID(SparkFrameView(window), testID))) return YES;
      return NO;
    }, ^(BOOL found) {
      if (!found) { reply(SparkFailure(@"E_TIMEOUT", [NSString stringWithFormat:@"No view with testID %@", testID])); return; }
      // Points from the top-left of the frame view, the area `capture` renders, so frames map onto capture pixels.
      NSView *root = SparkFrameView(match.window);
      NSRect frame = [match convertRect:match.bounds toView:root];
      if (!root.isFlipped) frame.origin.y = NSHeight(root.bounds) - NSMaxY(frame);
      reply(@{ @"ok": @YES, @"window": match.window.identifier ?: @"", @"frame": @{ @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) } });
    });
  }
  else if ([command isEqual:@"setAppAppearance"]) SparkSetAppearance(request, reply);
  else if ([command isEqual:@"capture"]) SparkCapture(request, reply);
  else if ([command isEqual:@"pointerEvents"]) {
    SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 5), ^{ return SparkSettled(); }, ^(BOOL settled) {
      if (!settled) { reply(SparkFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
      // Gesture recognizers attach after their views mount; do not click mid-mount.
      SparkPointerEvents(request, reply);
    });
  }
  else if ([command isEqual:@"restorePointer"]) { SparkRestorePointer(); reply(@{ @"ok": @YES }); }
  else if ([command isKindOfClass:NSString.class] && SparkModuleCommands()[command]) SparkModuleCommands()[command](request, reply);
  else reply(SparkFailure(@"E_UNKNOWN_COMMAND", [NSString stringWithFormat:@"Unknown command %@", command]));
}

static NSDictionary *SparkParse(NSData *line) {
  id value = line ? [NSJSONSerialization JSONObjectWithData:line options:0 error:nil] : nil;
  return [value isKindOfClass:NSDictionary.class] ? value : nil;
}
static void SparkSession(int fd) {
  NSMutableData *buffer = [NSMutableData new];
  struct timeval limit = { 10, 0 }, unlimited = { 0, 0 };
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &limit, sizeof limit);
  NSString *presented = SparkParse(SparkReadLine(fd, buffer))[@"token"];
  NSData *candidate = [presented isKindOfClass:NSString.class] ? [presented dataUsingEncoding:NSUTF8StringEncoding] : nil;
  if (candidate.length != token.length || timingsafe_bcmp(candidate.bytes, token.bytes, token.length) != 0) {
    NSLog(@"Spark test driver: authentication failed");
    SparkSend(fd, SparkFailure(@"E_AUTH", @"Authentication failed"));
    return;
  }
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &unlimited, sizeof unlimited);
  authenticated = true;
  if (!SparkSend(fd, @{ @"ok": @YES, @"protocol": @1 })) return;
  for (;;) {
    NSData *line = SparkReadLine(fd, buffer);
    if (!line) return;
    NSDictionary *request = SparkParse(line);
    id identifier = request[@"id"] ?: NSNull.null;
    if ([request[@"command"] isEqual:@"quit"]) { SparkSend(fd, @{ @"id": identifier, @"ok": @YES }); return; }
    __block NSDictionary *reply = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    if (!request) reply = SparkFailure(@"E_INVALID_ARGUMENT", @"Expected a JSON object");
    else dispatch_async(dispatch_get_main_queue(), ^{
      SparkExecute(request, ^(NSDictionary *result) { reply = result; dispatch_semaphore_signal(done); });
    });
    if (request) dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    NSMutableDictionary *message = [reply mutableCopy];
    message[@"id"] = identifier;
    if (!SparkSend(fd, message)) return;
  }
}
// One session per launch. When it ends (quit, disconnect or failed
// authentication) the driver closes and the app quits: it belongs to the runner.
static void SparkServe(void) {
  int fd;
  do fd = accept(listenFD, NULL, NULL); while (fd < 0 && errno == EINTR);
  if (fd >= 0) {
    uid_t uid; gid_t gid;
    int one = 1, flags = fcntl(fd, F_GETFL);
    // Accepted sockets inherit the listener's flags; replies rely on blocking I/O.
    if (getpeereid(fd, &uid, &gid) == 0 && uid == getuid() && flags >= 0 && fcntl(fd, F_SETFL, flags & ~O_NONBLOCK) == 0 &&
        fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 && setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one) == 0)
      SparkSession(fd);
    else NSLog(@"Spark test driver: rejected a client");
    close(fd);
  }
  close(listenFD);
  unlink(socketPath.fileSystemRepresentation);
  dispatch_async(dispatch_get_main_queue(), ^{ SparkRestorePointer(); SparkDriverTerminate(); });
}

BOOL SparkTestDriverStart(void) {
  NSCAssert(NSThread.isMainThread, @"The test driver starts on the main thread");
  const char *directory = getenv("SPARK_TEST_DRIVER_DIR");
  if (!directory) return NO;
  NSString *path = @(directory);
  unsetenv("SPARK_TEST_DRIVER_DIR"); // Child processes never inherit driver mode. Invalidates `directory`.
  if (!path.isAbsolutePath) SparkDriverRefuse(@"SPARK_TEST_DRIVER_DIR must be absolute");
  directoryFD = open(path.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directoryFD < 0 || !SparkPrivate(directoryFD, S_IFDIR, 0700)) SparkDriverRefuse(@"The run directory must be a 0700 directory owned by this user");
  token = SparkConsumeToken();
  if (!token) SparkDriverRefuse(@"The run directory needs a 0600 token file of 32-256 bytes");
  socketPath = [path stringByAppendingPathComponent:@"driver.sock"];
  listenFD = SparkListen(socketPath);
  if (listenFD < 0) SparkDriverRefuse([NSString stringWithFormat:@"Unable to listen on %@: %s", socketPath, strerror(errno)]);
  active = YES;
  // Never take focus from the person using this Mac, and avoid App Nap timer throttling.
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep reason:@"Spark test driver"];
  [NSThread detachNewThreadWithBlock:^{ SparkServe(); }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (authenticated) return;
    NSLog(@"Spark test driver: no authenticated client within 30 seconds");
    SparkDriverTerminate();
  });
  return YES;
}
