#import "SparkTestDriverPrivate.h"
#import "SparkSandbox.h"
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#include <atomic>
#include <fcntl.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>
#include <utility>

// libsystem_pthread: sets the calling thread's working directory to `fd` (-1: back to the process's). Not in the SDK headers.
extern "C" int pthread_fchdir_np(int fd);

// Protocol: newline-delimited JSON over a Unix socket in the run directory. The
// first message is {"token": "..."}; then one request at a time, each answered
// with {"id", "ok", ...} or {"id", "ok": false, "error": {"code", "message"}}.
typedef SparkTestDriverReply SparkDriverReply;
static BOOL active = NO, ending = NO;
static int directoryFD = -1, listenFD = -1;
// Where the socket is bound: the run directory, or for a sandboxed app a private directory in its container (`ownDirectory`).
static NSString *socketPath, *ownDirectory;
static NSData *token;
static id activity;
static std::atomic<bool> authenticated{false};
static CFTimeInterval lastMount = 0;
static const CFTimeInterval SparkSettleInterval = 0.1;
// Startup phases (docs/test-driver.md#startup-phases), CACurrentMediaTime() seconds, 0 until reached. The bundle
// notification arrives on the JavaScript thread. Quiet points are the startup's settled moments: the last mount before
// 100 ms without one, and the elements (testIDs) the windows showed then; `settled` is the first with an element.
static CFTimeInterval processStart = 0, driverStart = 0, didFinishLaunching = 0, firstMount = 0;
static NSMutableArray<NSDictionary *> *quietPoints;
static const NSUInteger SparkMaxQuietPoints = 50;
static const CFTimeInterval SparkStartupWindow = 60;
static std::atomic<CFTimeInterval> bundleLoaded{0};
static const NSUInteger SparkMaxMessage = 1 << 20;

static void SparkDriverRefuse(NSString *message) {
  NSLog(@"Spark test driver: %@", message);
  exit(78); // EX_CONFIG: the runner's launch contract was violated.
}
static void SparkDriverTerminate(void) { ending = YES; [NSApp terminate:nil]; }
BOOL SparkTestDriverActive(void) { return active; }
BOOL SparkTestDriverEnding(void) { return ending; }
// Elements: visible views with a testID and an area.
static void SparkCollectShown(NSView *view, NSMutableSet<NSString *> *ids) {
  if (view.isHidden || view.alphaValue <= 0) return;
  if (view.accessibilityIdentifier.length && view.frame.size.width > 0 && view.frame.size.height > 0) [ids addObject:view.accessibilityIdentifier];
  for (NSView *child in view.subviews) SparkCollectShown(child, ids);
}
// Records a quiet point of the startup (its first 60 s, at most 50) when the UI has been quiet for 100 ms: seen by a
// wait for settling, or by the check each startup mount schedules. A mount changes the views, so a point the checks
// missed before the next mount is not recorded.
static void SparkNoteQuiet(CFTimeInterval now) {
  if (!lastMount || now - lastMount < SparkSettleInterval || lastMount - firstMount > SparkStartupWindow || quietPoints.count >= SparkMaxQuietPoints) return;
  if ([quietPoints.lastObject[@"at"] doubleValue] == lastMount) return;
  NSMutableSet<NSString *> *ids = [NSMutableSet new];
  for (NSWindow *window in NSApp.windows) if (window.contentView) SparkCollectShown(window.contentView, ids);
  [quietPoints addObject:@{ @"at": @(lastMount), @"ids": ids }];
}
void SparkTestDriverDidMount(void) {
  const CFTimeInterval now = CACurrentMediaTime();
  if (!firstMount) firstMount = now;
  lastMount = now;
  if (now - firstMount <= SparkStartupWindow && quietPoints.count < SparkMaxQuietPoints)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(SparkSettleInterval * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ SparkNoteQuiet(CACurrentMediaTime()); });
}
void SparkTestDriverDidReload(void) { lastMount = 0; }
static NSArray<NSString *> *SparkBuiltInCommands(void) {
  return [[[@[@"ping", @"navigate", @"openFile", @"waitFor", @"elements", @"setAppAppearance", @"capture", @"menus", @"startup", @"quit"]
    arrayByAddingObjectsFromArray:SparkDriverInputCommandNames()] arrayByAddingObjectsFromArray:[SparkDriverFrameCommandNames() arrayByAddingObjectsFromArray:SparkDriverCommitCommandNames()]]
    arrayByAddingObjectsFromArray:SparkDriverAuditCommandNames()];
}
static NSMutableArray<dispatch_block_t> *SparkStartObservers(void) {
  static NSMutableArray *observers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ observers = [NSMutableArray new]; });
  return observers;
}
void SparkTestDriverObserveStart(dispatch_block_t observer) {
  NSCAssert(NSThread.isMainThread, @"Driver hooks are registered on the main thread");
  if (active) observer();
  else [SparkStartObservers() addObject:[observer copy]];
}
static NSMutableArray<dispatch_block_t> *SparkInputObservers(void) {
  static NSMutableArray *observers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ observers = [NSMutableArray new]; });
  return observers;
}
void SparkTestDriverObserveInput(dispatch_block_t observer) {
  NSCAssert(NSThread.isMainThread, @"Driver hooks are registered on the main thread");
  [SparkInputObservers() addObject:[observer copy]];
}
static void SparkNoteInput(void) { for (dispatch_block_t observer in SparkInputObservers()) observer(); }
static NSMutableArray<SparkTestDriverRenderWrapper> *SparkRenderWrappers(void) {
  static NSMutableArray *wrappers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ wrappers = [NSMutableArray new]; });
  return wrappers;
}
void SparkTestDriverWrapRender(SparkTestDriverRenderWrapper wrapper) {
  NSCAssert(NSThread.isMainThread, @"Driver hooks are registered on the main thread");
  [SparkRenderWrappers() addObject:[wrapper copy]];
}
static NSMutableArray<SparkTestDriverStateObserver> *SparkStateObservers(void) {
  static NSMutableArray *observers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ observers = [NSMutableArray new]; });
  return observers;
}
void SparkTestDriverObserveSimulatedState(SparkTestDriverStateObserver observer) {
  NSCAssert(NSThread.isMainThread, @"Driver hooks are registered on the main thread");
  [SparkStateObservers() addObject:[observer copy]];
}
void SparkTestDriverDidSimulateState(NSDictionary *values) {
  NSCAssert(NSThread.isMainThread, @"Simulated state is reported on the main thread");
  for (SparkTestDriverStateObserver observer in SparkStateObservers()) observer(values);
}
static NSMutableArray<SparkTestDriverClockObserver> *SparkClockObservers(void) {
  static NSMutableArray *observers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ observers = [NSMutableArray new]; });
  return observers;
}
void SparkTestDriverObserveClock(SparkTestDriverClockObserver observer) {
  NSCAssert(NSThread.isMainThread, @"Driver hooks are registered on the main thread");
  [SparkClockObservers() addObject:[observer copy]];
}
void SparkTestDriverDidChangeClock(BOOL virtualClock, double advancedMs) {
  NSCAssert(NSThread.isMainThread, @"Clock changes are reported on the main thread");
  for (SparkTestDriverClockObserver observer in SparkClockObservers()) observer(virtualClock, advancedMs);
}
// Runs `render` inside every registered wrapper, the first registered outermost.
static void SparkWrapped(NSUInteger index, dispatch_block_t render) {
  if (index == SparkRenderWrappers().count) { render(); return; }
  __block BOOL rendered = NO;
  SparkRenderWrappers()[index](^{ NSCAssert(!rendered, @"A render wrapper rendered twice"); rendered = YES; SparkWrapped(index + 1, render); });
  NSCAssert(rendered, @"A render wrapper did not render");
}
static NSMutableDictionary<NSString *, SparkTestDriverHandler> *SparkModuleCommands(void) {
  static NSMutableDictionary *commands;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ commands = [NSMutableDictionary new]; });
  return commands;
}
void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler) {
  NSCAssert(NSThread.isMainThread, @"Driver commands are registered on the main thread");
  if ([SparkBuiltInCommands() containsObject:name] || SparkModuleCommands()[name]) [NSException raise:NSInvalidArgumentException format:@"Driver command %@ is already defined", name];
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
// Binds `name` in `directory` relative to it, on this thread only (a container's path can exceed sun_path's 104 bytes).
static int SparkListen(int directory, const char *name) {
  struct sockaddr_un address = {};
  address.sun_family = AF_UNIX;
  if (strlcpy(address.sun_path, name, sizeof address.sun_path) >= sizeof address.sun_path) return -1;
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  if (pthread_fchdir_np(directory) != 0) { close(fd); return -1; }
  // Nothing can connect before listen(), so tightening the mode after bind() is race-free.
  BOOL listening = fcntl(fd, F_SETFD, FD_CLOEXEC) == 0 && bind(fd, (struct sockaddr *)&address, sizeof address) == 0 &&
      chmod(address.sun_path, 0600) == 0 && listen(fd, 1) == 0;
  int saved = errno;
  pthread_fchdir_np(-1);
  if (!listening) { close(fd); errno = saved; return -1; }
  return fd;
}
// The App Sandbox lets an app bind Unix sockets only inside its container, so a sandboxed app listens in a private
// directory of its own temporary directory and links the run directory's driver.sock to that socket; the runner
// connects through the link (docs/test-driver.md#sandboxed-apps). The run directory itself the app reaches through the
// file-access exception the runner signs its copy of the app with.
static int SparkListenSandboxed(void) {
  NSString *pattern = [NSTemporaryDirectory() stringByAppendingPathComponent:@"spark-driver-XXXXXX"];
  char *buffer = strdup(pattern.fileSystemRepresentation);
  if (!buffer || !mkdtemp(buffer)) { free(buffer); return -1; } // mkdtemp creates it 0700.
  ownDirectory = [NSFileManager.defaultManager stringWithFileSystemRepresentation:buffer length:strlen(buffer)];
  free(buffer);
  int own = open(ownDirectory.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  int fd = own < 0 ? -1 : SparkListen(own, "driver.sock");
  int saved = errno;
  if (own >= 0) close(own);
  socketPath = [ownDirectory stringByAppendingPathComponent:@"driver.sock"];
  if (fd >= 0 && symlinkat(socketPath.fileSystemRepresentation, directoryFD, "driver.sock") == 0) return fd;
  saved = fd < 0 ? saved : errno;
  if (fd >= 0) close(fd);
  unlink(socketPath.fileSystemRepresentation);
  rmdir(ownDirectory.fileSystemRepresentation);
  errno = saved;
  return -1;
}
static void SparkStopListening(void) {
  close(listenFD);
  unlink(socketPath.fileSystemRepresentation);
  if (ownDirectory) {
    unlinkat(directoryFD, "driver.sock", 0);
    rmdir(ownDirectory.fileSystemRepresentation);
  }
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
NSDictionary *SparkDriverFailure(NSString *code, NSString *message) {
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
static BOOL SparkSettled(void) {
  const CFTimeInterval now = CACurrentMediaTime();
  SparkNoteQuiet(now);
  return now - lastMount >= SparkSettleInterval;
}
static NSTimeInterval SparkTimeout(id value, NSTimeInterval fallback) {
  return [value isKindOfClass:NSNumber.class] ? MIN(MAX([value doubleValue], 0), 120000) / 1000 : fallback;
}
void SparkDriverWhenSettled(id timeoutMs, void (^done)(BOOL settled)) { SparkWaitUntil(SparkTimeout(timeoutMs, 5), ^{ return SparkSettled(); }, done); }
NSView *SparkDriverFrameView(NSWindow *window) { return window.contentView.superview ?: window.contentView; }
NSView *SparkDriverFindTestID(NSView *view, NSString *testID) {
  if (view.isHidden) return nil;
  if ([view.accessibilityIdentifier isEqualToString:testID]) return view;
  for (NSView *child in view.subviews) {
    NSView *match = SparkDriverFindTestID(child, testID);
    if (match) return match;
  }
  return nil;
}
NSView *SparkDriverFindView(NSString *testID) {
  for (NSWindow *window in NSApp.windows) {
    NSView *match = SparkDriverFindTestID(SparkDriverFrameView(window), testID);
    if (match) return match;
  }
  return nil;
}
NSView *SparkTestDriverFindView(NSString *testID) { return SparkDriverFindView(testID); }
NSWindow *SparkDriverResolveWindow(id target, NSString **failure) {
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
BOOL SparkDriverCaptureName(id name) {
  if (![name isKindOfClass:NSString.class] || [name length] < 1 || [name length] > 100) return NO;
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"];
  return [name rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound && [name characterAtIndex:0] != '-';
}
// How `capture` renders (docs/test-driver.md#what-a-capture-contains): Core Animation's own renderer by default, or
// with SPARK_TEST_DRIVER_CAPTURE=views AppKit's view drawing, the earlier path, which skips what only the compositor draws.
// The renderer needs QuartzCore SPI, so it compiles only with SPARK_TEST_DRIVER_PRIVATE_EVENTS; without it views are drawn.
static BOOL drawViews = !SPARK_TEST_DRIVER_PRIVATE_EVENTS;
static NSBitmapImageRep *SparkDrawViews(NSView *view) {
  NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  return rep;
}
#if SPARK_TEST_DRIVER_PRIVATE_EVENTS
// QuartzCore SPI: the CAContext a window shows its layer tree through. CARenderer takes the tree's root from it.
@protocol SparkLayerContext
@property (strong) CALayer *layer;
@end
@interface CALayer (SparkLayerContext)
- (id<SparkLayerContext>)context;
@end
// Renders the window's whole layer tree with CARenderer into a Metal texture, as the compositor would: layer filters,
// shadows, 3D transforms, Metal layers, particles and within-window backdrops included. Layer time is 0, before every
// animation that runs on real time began, so those render at their model values (as view drawing renders them), while
// layers the motion virtual clock pauses render at its frozen instant. The root goes back to the window's context after.
static NSBitmapImageRep *SparkRenderLayers(NSWindow *window, NSView *view, NSString **failure) {
  static id<MTLDevice> device;
  static id<MTLCommandQueue> queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ device = MTLCreateSystemDefaultDevice(); queue = [device newCommandQueue]; });
  CALayer *root = view.layer.superlayer;
  if (!device || !root) {
    *failure = !device ? @"No Metal device renders the window's layers; SPARK_TEST_DRIVER_CAPTURE=views draws its views instead" : @"The window has no layer tree";
    return nil;
  }
  const CGFloat scale = window.backingScaleFactor;
  const NSUInteger width = (NSUInteger)llround(NSWidth(view.bounds) * scale), height = (NSUInteger)llround(NSHeight(view.bounds) * scale);
  MTLTextureDescriptor *descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm width:width height:height mipmapped:NO];
  descriptor.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
  descriptor.storageMode = MTLStorageModeShared;
  id<MTLTexture> texture = [device newTextureWithDescriptor:descriptor];
  CARenderer *renderer = [CARenderer rendererWithMTLTexture:texture options:@{ kCARendererMetalCommandQueue: queue, kCARendererColorSpace: (__bridge id)window.colorSpace.CGColorSpace }];
  id<SparkLayerContext> context = root.context;
  const CATransform3D transform = root.sublayerTransform;
  // The renderer draws what transactions commit after it takes the layer.
  renderer.layer = root;
  renderer.bounds = CGRectMake(0, 0, width, height);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  root.sublayerTransform = CATransform3DMakeScale(scale, scale, 1);
  [CATransaction commit];
  [CATransaction flush];
  [renderer beginFrameAtTime:0 timeStamp:NULL];
  [renderer addUpdateRect:renderer.bounds];
  [renderer render];
  [renderer endFrame];
  id<MTLCommandBuffer> done = [queue commandBuffer];
  [done commit];
  [done waitUntilCompleted];
  renderer.layer = nil;
  context.layer = root;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  root.sublayerTransform = transform;
  [CATransaction commit];
  if (context && (context.layer != root || root.context != context)) {
    *failure = @"The window's layer tree could not be given back to its context after the render";
    return nil;
  }
  // BGRA rows from the bottom up, into RGBA rows from the top down.
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)width pixelsHigh:(NSInteger)height bitsPerSample:8
    samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bitmapFormat:0 bytesPerRow:(NSInteger)width * 4 bitsPerPixel:32];
  uint8_t *pixels = rep.bitmapData;
  for (NSUInteger row = 0; row < height; row++)
    [texture getBytes:pixels + (height - 1 - row) * width * 4 bytesPerRow:width * 4 fromRegion:MTLRegionMake2D(0, row, width, 1) mipmapLevel:0];
  for (NSUInteger i = 0; i < width * height * 4; i += 4) std::swap(pixels[i], pixels[i + 2]);
  return [rep bitmapImageRepByRetaggingWithColorSpace:window.colorSpace];
}
#else
static NSBitmapImageRep *SparkRenderLayers(NSWindow *, NSView *, NSString **failure) {
  *failure = @"The app was built without SPARK_TEST_DRIVER_PRIVATE_EVENTS (macos.testDriverPrivateEvents), so captures draw views";
  return nil;
}
#endif
// A selected source-list row in a window that is not key (driver windows never are) draws its selection as
// a black layer that the window server turns into a tint with a vibrant compositing filter. Drawing views
// skips the filter and the row is solid black, so for the capture that layer is hidden under the
// system's unemphasized selection color, then restored. The selection is the row view's subview that is not
// a cell. On macOS 27 it is an NSVisualEffectView (material .selection) whose sublayer has the filter; on
// macOS 26 it is a private view whose own layer has it.
static void SparkCoverFilteredLayer(CALayer *layer, NSAppearance *appearance, NSMutableArray<dispatch_block_t> *restore) {
  if (layer.hidden) return;
  if (!layer.compositingFilter) {
    for (CALayer *sublayer in [layer.sublayers copy]) SparkCoverFilteredLayer(sublayer, appearance, restore);
    return;
  }
  CALayer *cover = [CALayer layer];
  cover.frame = layer.frame; cover.cornerRadius = layer.cornerRadius; cover.cornerCurve = layer.cornerCurve; cover.maskedCorners = layer.maskedCorners;
  [appearance performAsCurrentDrawingAppearance:^{ cover.backgroundColor = NSColor.unemphasizedSelectedContentBackgroundColor.CGColor; }];
  [layer.superlayer insertSublayer:cover above:layer];
  layer.hidden = YES;
  [restore addObject:^{ layer.hidden = NO; [cover removeFromSuperlayer]; }];
}
static void SparkCoverSelectionMaterials(NSView *view, NSMutableArray<dispatch_block_t> *restore) {
  if (view.isHidden) return;
  NSTableRowView *row = [view isKindOfClass:NSTableRowView.class] ? (NSTableRowView *)view : nil;
  if (row.selected && !row.emphasized) {
    NSMutableSet<NSView *> *cells = [NSMutableSet new];
    for (NSInteger column = 0; column < row.numberOfColumns; column++) if ([row viewAtColumn:column]) [cells addObject:[row viewAtColumn:column]];
    for (NSView *child in row.subviews) {
      if ([cells containsObject:child] || child.isHidden || !child.layer) continue;
      [child.layer displayIfNeeded]; // AppKit adds the material layer when the view's layer first displays.
      SparkCoverFilteredLayer(child.layer, row.effectiveAppearance, restore);
    }
  }
  for (NSView *child in view.subviews) SparkCoverSelectionMaterials(child, restore);
}
// What `capture` renders: the window's frame view, inside the modules' render wrappers (with source-list selections
// covered when drawing views); nil with `failure` set when it cannot be rendered.
NSBitmapImageRep *SparkDriverRenderWindow(NSWindow *window, NSString **failure) {
  NSView *view = SparkDriverFrameView(window);
  __block NSBitmapImageRep *rep = nil;
  __block NSString *reason = nil;
  SparkWrapped(0, ^{
    [window layoutIfNeeded];
    [view displayIfNeeded];
    if (!drawViews) {
      NSString *layersFailure = nil;
      rep = SparkRenderLayers(window, view, &layersFailure);
      reason = layersFailure;
      return;
    }
    NSMutableArray<dispatch_block_t> *restore = [NSMutableArray new];
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    SparkCoverSelectionMaterials(view, restore);
    rep = SparkDrawViews(view);
    for (dispatch_block_t undo in restore) undo();
    [CATransaction commit];
  });
  if (!rep) *failure = reason;
  return rep;
}
// Captures are created only inside the runner's private run directory.
int SparkDriverWriteCapture(NSString *file, NSData *data) {
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
  NSWindow *window = SparkDriverResolveWindow(request[@"window"], &failure);
  if (!window) { reply(SparkDriverFailure(@"E_NO_WINDOW", failure)); return; }
  NSString *name = request[@"name"];
  if (!SparkDriverCaptureName(name)) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"Capture names use 1-100 of [A-Za-z0-9_-] and do not start with -")); return; }
  SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 5), ^{ return SparkSettled(); }, ^(BOOL settled) {
    if (!settled) { reply(SparkDriverFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
    NSString *renderFailure = nil;
    NSBitmapImageRep *rep = SparkDriverRenderWindow(window, &renderFailure);
    if (!rep) { reply(SparkDriverFailure(@"E_RENDER", renderFailure)); return; }
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png) { reply(SparkDriverFailure(@"E_RENDER", @"Rendering produced no image")); return; }
    NSString *file = [name stringByAppendingPathExtension:@"png"];
    int error = SparkDriverWriteCapture(file, png);
    if (error) { reply(SparkDriverFailure(@"E_IO", [NSString stringWithFormat:@"%@: %s", file, strerror(error)])); return; }
    reply(@{ @"ok": @YES, @"file": file, @"width": @(rep.pixelsWide), @"height": @(rep.pixelsHigh), @"scale": @(window.backingScaleFactor), @"renderer": drawViews ? @"views" : @"layers" });
  });
}
static void SparkSetAppearance(NSDictionary *request, SparkDriverReply reply) {
  NSString *value = request[@"appearance"];
  NSAppearanceName name = [value isEqual:@"dark"] ? NSAppearanceNameDarkAqua : [value isEqual:@"light"] ? NSAppearanceNameAqua : nil;
  if (!name) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"Appearance is light or dark")); return; }
  NSTimeInterval timeout = SparkTimeout(request[@"timeoutMs"], 10);
  // An override set while the app is still launching did not last (its first render came out in the OS
  // appearance), so it is applied once the first rendered UI has settled, as navigate waits too.
  SparkWaitUntil(timeout, ^{ return (BOOL)(lastMount > 0 && SparkSettled()); }, ^(BOOL launched) {
    if (!launched) { reply(SparkDriverFailure(@"E_TIMEOUT", @"The app has not rendered")); return; }
    NSArray *names = @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua];
    BOOL changed = ![[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:names] isEqualToString:name];
    // The app-level override, independent of the OS setting; per-window overrides still win.
    NSApp.appearance = [NSAppearance appearanceNamed:name];
    if (!changed) { reply(@{ @"ok": @YES, @"changed": @NO }); return; }
    CFTimeInterval changedAt = CACurrentMediaTime();
    SparkWaitUntil(timeout, ^{ return (BOOL)(lastMount > changedAt && SparkSettled()); }, ^(BOOL rendered) {
      reply(rendered ? @{ @"ok": @YES, @"changed": @YES } : SparkDriverFailure(@"E_TIMEOUT", @"No UI update followed the appearance change"));
    });
  });
}
// Deep links and files arrive through application:openURLs:, the path the OS uses for a
// clicked link or a file opened from Finder, once the first render has settled so the
// app's link and open-file listeners are subscribed.
static void SparkOpenURL(NSURL *url, NSDictionary *request, SparkDriverReply reply) {
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(application:openURLs:)]) { reply(SparkDriverFailure(@"E_UNSUPPORTED", @"The application delegate does not open URLs")); return; }
  SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 30), ^{ return (BOOL)(lastMount > 0 && SparkSettled()); }, ^(BOOL rendered) {
    if (!rendered) { reply(SparkDriverFailure(@"E_TIMEOUT", @"The app has not rendered")); return; }
    SparkNoteInput();
    [delegate application:NSApp openURLs:@[url]];
    reply(@{ @"ok": @YES });
  });
}
// Points from the top-left of the window's frame view, the area `capture` renders, so frames map onto capture pixels.
NSDictionary *SparkDriverFrame(NSView *view) {
  NSView *root = SparkDriverFrameView(view.window);
  NSRect frame = [view convertRect:view.bounds toView:root];
  if (!root.isFlipped) frame.origin.y = NSHeight(root.bounds) - NSMaxY(frame);
  return @{ @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) };
}
static NSString *SparkNonEmpty(id value) { return [value isKindOfClass:NSString.class] && [value length] ? value : nil; }
NSString *SparkDriverRoleName(id role) {
  NSString *name = SparkNonEmpty(role);
  if ([name isEqual:NSAccessibilityUnknownRole]) return nil;
  return [name hasPrefix:@"AX"] && name.length > 2 ? [[[name substringWithRange:NSMakeRange(2, 1)] lowercaseString] stringByAppendingString:[name substringFromIndex:3]] : name;
}
// An NSTabView's tab buttons (NSTabViewItem) implement only the legacy accessibility attribute protocol. In process,
// their AXPosition and AXSize are a screen rect, as accessibilityFrame is.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static id SparkPart(id part, SEL modern, NSString *attribute) {
  if ([part respondsToSelector:modern]) return ((id (*)(id, SEL))[part methodForSelector:modern])(part, modern);
  return [part accessibilityAttributeValue:attribute];
}
static NSRect SparkPartFrame(id part) {
  if ([part respondsToSelector:@selector(accessibilityFrame)]) return [part accessibilityFrame];
  return (NSRect){ [[part accessibilityAttributeValue:NSAccessibilityPositionAttribute] pointValue], [[part accessibilityAttributeValue:NSAccessibilitySizeAttribute] sizeValue] };
}
#pragma clang diagnostic pop
// The components of an NSPathControl and the tab buttons of an NSTabView, accessibility elements that are not views,
// as an AX client sees them: role, label and text as for views, and the frame converted from screen coordinates.
// (Walking every control's accessibility children this way made `elements` take seconds in the Kitchen Sink.)
static void SparkCollectParts(id parent, NSWindow *window, NSString *windowID, NSMutableDictionary *owner, NSMutableArray *elements, int depth) {
  if (!depth) return;
  for (id child in SparkPart(parent, @selector(accessibilityChildren), NSAccessibilityChildrenAttribute)) {
    if ([child isKindOfClass:NSView.class]) continue;
    NSString *role = SparkDriverRoleName(SparkPart(child, @selector(accessibilityRole), NSAccessibilityRoleAttribute)), *label = SparkNonEmpty(SparkPart(child, @selector(accessibilityLabel), NSAccessibilityDescriptionAttribute));
    NSString *text = SparkNonEmpty(SparkPart(child, @selector(accessibilityValue), NSAccessibilityValueAttribute)) ?: SparkNonEmpty(SparkPart(child, @selector(accessibilityTitle), NSAccessibilityTitleAttribute));
    NSMutableDictionary *element = owner;
    if (role || label || text) {
      NSView *root = SparkDriverFrameView(window);
      NSRect frame = [window convertRectFromScreen:SparkPartFrame(child)];
      if (!root.isFlipped) frame.origin.y = NSHeight(root.bounds) - NSMaxY(frame);
      element = [@{ @"key": [NSString stringWithFormat:@"%lu", (unsigned long)elements.count], @"window": windowID,
        @"frame": @{ @"x": @(frame.origin.x), @"y": @(frame.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) } } mutableCopy];
      element[@"parent"] = owner[@"key"]; element[@"role"] = role; element[@"label"] = label; element[@"text"] = text;
      [elements addObject:element];
    }
    SparkCollectParts(child, window, windowID, element, elements, depth - 1);
  }
}
// The in-process accessibility view of a window: every visible view with a testID, and every accessibility element
// (controls through their cells, as AppKit exposes them) with a role, label or text. `role` is the NSAccessibility
// role without AX (AXButton is button). `text` is the string value, else the title, else the displayed text of a
// view with attributed text (React Native Text). `enabled` and `selected` are its isAccessibilityEnabled and
// isAccessibilitySelected (a control's through its cell). A view inside an element with the same testID (a native control a
// React Native view hosts) refines that element instead of adding one.
static void SparkCollectElements(NSView *view, NSString *window, NSMutableDictionary *parent, NSMutableArray *elements) {
  if (view.isHidden) return;
  NSString *testID = SparkNonEmpty(view.accessibilityIdentifier);
  NSCell *cell = [view isKindOfClass:NSControl.class] ? ((NSControl *)view).cell : nil;
  NSMutableDictionary *element = parent;
  if (testID || cell || view.isAccessibilityElement) {
    NSString *role = SparkDriverRoleName(SparkNonEmpty(cell.accessibilityRole) ?: view.accessibilityRole), *label = SparkNonEmpty(view.accessibilityLabel);
    id attributed = [view respondsToSelector:@selector(attributedText)] ? [view valueForKey:@"attributedText"] : nil;
    NSString *text = SparkNonEmpty(view.accessibilityValue) ?: SparkNonEmpty(cell.accessibilityValue) ?: SparkNonEmpty(view.accessibilityTitle)
      ?: ([attributed isKindOfClass:NSAttributedString.class] ? SparkNonEmpty([attributed string]) : nil);
    id rawValue = view.accessibilityValue ?: cell.accessibilityValue;
    NSString *value = [rawValue isKindOfClass:NSNumber.class] ? [rawValue stringValue] : SparkNonEmpty(rawValue);
    NSNumber *enabled = @(cell ? cell.isAccessibilityEnabled : view.isAccessibilityEnabled), *selected = @(cell ? cell.isAccessibilitySelected : view.isAccessibilitySelected);
    if (testID && [parent[@"id"] isEqual:testID]) {
      parent[@"frame"] = SparkDriverFrame(view);
      parent[@"enabled"] = enabled; parent[@"selected"] = selected;
      if (role) parent[@"role"] = role;
      if (label) parent[@"label"] = label;
      if (text) parent[@"text"] = text;
      if (value) parent[@"value"] = value;
    } else if (testID || role || label || text) {
      element = [@{ @"key": [NSString stringWithFormat:@"%lu", (unsigned long)elements.count], @"window": window, @"frame": SparkDriverFrame(view) } mutableCopy];
      element[@"parent"] = parent[@"key"]; element[@"id"] = testID; element[@"role"] = role; element[@"label"] = label; element[@"text"] = text; element[@"value"] = value;
      element[@"enabled"] = enabled; element[@"selected"] = selected;
      [elements addObject:element];
    }
  }
  if ([view isKindOfClass:NSPathControl.class] || [view isKindOfClass:NSTabView.class]) SparkCollectParts(view, view.window, window, element, elements, 2);
  for (NSView *child in view.subviews) SparkCollectElements(child, window, element, elements);
}
static void SparkElements(SparkDriverReply reply) {
  NSMutableArray *windows = [NSMutableArray new], *elements = [NSMutableArray new];
  for (NSWindow *window in NSApp.orderedWindows.count ? [NSApp.orderedWindows arrayByAddingObjectsFromArray:NSApp.windows] : NSApp.windows) {
    NSString *identifier = SparkNonEmpty(window.identifier);
    if (!identifier || !window.contentView || [[windows valueForKey:@"id"] containsObject:identifier]) continue;
    NSView *root = SparkDriverFrameView(window);
    [windows addObject:@{ @"id": identifier, @"title": window.title, @"key": @(window.isKeyWindow), @"main": @([identifier isEqual:@"spark.main"]),
      @"frame": @{ @"x": @0, @"y": @0, @"width": @(NSWidth(root.bounds)), @"height": @(NSHeight(root.bounds)) } }];
    SparkCollectElements(root, identifier, nil, elements);
  }
  reply(@{ @"ok": @YES, @"windows": windows, @"elements": elements });
}
// The application menu as AppKit holds it. A driven app has no menu bar on screen, but NSApp.mainMenu exists.
// -[NSMenu update] runs validation first, so `enabled` and `state` are what a user opening the menu would see.
static NSArray *SparkMenuItems(NSMenu *menu) {
  [menu update];
  NSMutableArray *items = [NSMutableArray new];
  for (NSMenuItem *item in menu.itemArray) {
    if (item.isSeparatorItem) { [items addObject:@{ @"separator": @YES }]; continue; }
    NSMutableDictionary *entry = [@{ @"title": item.title, @"enabled": @(item.enabled), @"hidden": @(item.hidden),
      @"state": item.state == NSControlStateValueOn ? @"on" : item.state == NSControlStateValueMixed ? @"mixed" : @"off" } mutableCopy];
    if (item.identifier) entry[@"id"] = item.identifier;
    if (item.keyEquivalent.length) entry[@"shortcut"] = @{ @"key": item.keyEquivalent, @"modifiers": @(item.keyEquivalentModifierMask & NSEventModifierFlagDeviceIndependentFlagsMask) };
    if (item.toolTip) entry[@"toolTip"] = item.toolTip;
    if (item.alternate) entry[@"alternate"] = @YES;
    // The Services menu is the system's; populating it would ask every installed service.
    if (item.submenu && item.submenu != NSApp.servicesMenu) entry[@"items"] = SparkMenuItems(item.submenu);
    [items addObject:entry];
  }
  return items;
}
// When the kernel started this process, on the CACurrentMediaTime() clock; 0 if it does not say.
static CFTimeInterval SparkProcessStart(void) {
  struct kinfo_proc info = {};
  size_t size = sizeof info;
  int name[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() };
  struct timeval now;
  if (sysctl(name, 4, &info, &size, NULL, 0) != 0 || size != sizeof info || gettimeofday(&now, NULL) != 0) return 0;
  const struct timeval started = info.kp_proc.p_starttime;
  return CACurrentMediaTime() - ((now.tv_sec - started.tv_sec) + (now.tv_usec - started.tv_usec) / 1e6);
}
// The first quiet point of the startup that shows an element, or the element `testID`.
static NSDictionary *SparkQuietPoint(NSString *testID) {
  for (NSDictionary *point in quietPoints) if (testID ? [point[@"ids"] containsObject:testID] : [point[@"ids"] count] > 0) return point;
  return nil;
}
// Startup phases in milliseconds since the process started, once the first rendered UI has settled; with `testID`, also
// `ready`, once that element has shown at a quiet point.
static void SparkStartup(NSDictionary *request, SparkDriverReply reply) {
  if (!processStart) { reply(SparkDriverFailure(@"E_UNAVAILABLE", @"The kernel did not report when this process started")); return; }
  NSString *testID = request[@"testID"];
  if (testID && (![testID isKindOfClass:NSString.class] || !testID.length)) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"startup testID must be a non-empty string")); return; }
  SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 30), ^{ SparkSettled(); return (BOOL)(SparkQuietPoint(nil) && (!testID || SparkQuietPoint(testID))); }, ^(BOOL settled) {
    if (!settled) {
      NSString *what = !firstMount ? @"The app has not mounted UI" : !SparkQuietPoint(nil) ? @"The first UI did not show an element (a view with a testID) and stop mounting changes for 100 ms"
        : [NSString stringWithFormat:@"%@ was not shown when the UI stopped mounting changes for 100 ms during its first %.0f s", testID, SparkStartupWindow];
      reply(SparkDriverFailure(@"E_TIMEOUT", [what stringByAppendingString:@" before the timeout"]));
      return;
    }
    NSMutableDictionary *phases = [NSMutableDictionary new];
    NSDictionary *times = @{ @"willFinishLaunching": @(driverStart), @"didFinishLaunching": @(didFinishLaunching), @"bundleLoaded": @(bundleLoaded.load()),
      @"firstMount": @(firstMount), @"settled": SparkQuietPoint(nil)[@"at"], @"ready": testID ? SparkQuietPoint(testID)[@"at"] : @0 };
    for (NSString *phase in times) if ([times[phase] doubleValue] > 0) phases[phase] = @(([times[phase] doubleValue] - processStart) * 1000);
    reply(@{ @"ok": @YES, @"phases": phases });
  });
}
static void SparkExecute(NSDictionary *request, SparkDriverReply reply) {
  NSString *command = request[@"command"];
  if ([command isEqual:@"ping"]) reply(@{ @"ok": @YES });
  else if ([command isEqual:@"navigate"]) {
    NSURL *url = [request[@"url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:request[@"url"]] : nil;
    if (!url.scheme.length || url.isFileURL) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"navigate expects a non-file URL; open files with openFile")); return; }
    SparkOpenURL(url, request, reply);
  }
  else if ([command isEqual:@"openFile"]) {
    NSString *path = request[@"path"];
    if (![path isKindOfClass:NSString.class] || !path.isAbsolutePath) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"openFile expects an absolute path")); return; }
    BOOL directory = NO;
    if (![NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&directory]) { reply(SparkDriverFailure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No file at %@", path])); return; }
    SparkOpenURL([NSURL fileURLWithPath:path isDirectory:directory], request, reply);
  }
  else if ([command isEqual:@"waitFor"]) {
    NSString *testID = request[@"testID"];
    if (![testID isKindOfClass:NSString.class] || !testID.length) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"waitFor expects testID")); return; }
    __block NSView *match = nil;
    SparkWaitUntil(SparkTimeout(request[@"timeoutMs"], 10), ^{ return (BOOL)((match = SparkDriverFindView(testID)) != nil); }, ^(BOOL found) {
      if (!found) { reply(SparkDriverFailure(@"E_TIMEOUT", [NSString stringWithFormat:@"No view with testID %@", testID])); return; }
      reply(@{ @"ok": @YES, @"window": match.window.identifier ?: @"", @"frame": SparkDriverFrame(match) });
    });
  }
  else if ([command isEqual:@"elements"]) SparkElements(reply);
  else if ([command isEqual:@"setAppAppearance"]) SparkSetAppearance(request, reply);
  else if ([command isEqual:@"capture"]) SparkCapture(request, reply);
  else if ([SparkDriverInputCommandNames() containsObject:command]) { SparkNoteInput(); SparkDriverInput(command, request, reply); }
  else if ([SparkDriverFrameCommandNames() containsObject:command]) SparkDriverFrames(command, request, reply);
  else if ([SparkDriverCommitCommandNames() containsObject:command]) SparkDriverCommits(command, request, reply);
  else if ([command isEqual:@"startup"]) SparkStartup(request, reply);
  else if ([SparkDriverAuditCommandNames() containsObject:command]) SparkDriverAudit(request, reply);
  else if ([command isEqual:@"menus"]) reply(@{ @"ok": @YES, @"menus": NSApp.mainMenu ? SparkMenuItems(NSApp.mainMenu) : @[] });
  else if ([command isKindOfClass:NSString.class] && SparkModuleCommands()[command]) SparkModuleCommands()[command](request, reply);
  else reply(SparkDriverFailure(@"E_UNKNOWN_COMMAND", [NSString stringWithFormat:@"Unknown command %@", command]));
}

// Requests run as main run-loop blocks in the common modes, not on the main queue: a nested run loop started
// from a main-queue block does not drain the main queue, so a modal or tracking loop the app enters (for example
// in response to driver input) would block every later request. Run-loop blocks also run inside those loops.
static void SparkOnMain(dispatch_block_t block) {
  CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, block);
  CFRunLoopWakeUp(CFRunLoopGetMain());
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
    SparkSend(fd, SparkDriverFailure(@"E_AUTH", @"Authentication failed"));
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
    if (!request) reply = SparkDriverFailure(@"E_INVALID_ARGUMENT", @"Expected a JSON object");
    else SparkOnMain(^{ SparkExecute(request, ^(NSDictionary *result) { reply = result; dispatch_semaphore_signal(done); }); });
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
  SparkStopListening();
  SparkOnMain(^{ SparkDriverTerminate(); });
}

BOOL SparkTestDriverStart(void) {
  NSCAssert(NSThread.isMainThread, @"The test driver starts on the main thread");
  const char *directory = getenv("SPARK_TEST_DRIVER_DIR");
  if (!directory) return NO;
  NSString *path = @(directory);
  unsetenv("SPARK_TEST_DRIVER_DIR"); // Child processes never inherit driver mode. Invalidates `directory`.
  if (!path.isAbsolutePath) SparkDriverRefuse(@"SPARK_TEST_DRIVER_DIR must be absolute");
  const char *capture = getenv("SPARK_TEST_DRIVER_CAPTURE");
  if (capture && strcmp(capture, "views") && strcmp(capture, "layers")) SparkDriverRefuse(@"SPARK_TEST_DRIVER_CAPTURE is layers or views");
  if (capture && !strcmp(capture, "layers") && !SPARK_TEST_DRIVER_PRIVATE_EVENTS)
    SparkDriverRefuse(@"SPARK_TEST_DRIVER_CAPTURE=layers needs an app built with SPARK_TEST_DRIVER_PRIVATE_EVENTS (macos.testDriverPrivateEvents)");
  if (capture) drawViews = !strcmp(capture, "views");
  unsetenv("SPARK_TEST_DRIVER_CAPTURE");
  directoryFD = open(path.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directoryFD < 0 || !SparkPrivate(directoryFD, S_IFDIR, 0700)) SparkDriverRefuse(@"The run directory must be a 0700 directory owned by this user");
  token = SparkConsumeToken();
  if (!token) SparkDriverRefuse(@"The run directory needs a 0600 token file of 32-256 bytes");
  socketPath = [path stringByAppendingPathComponent:@"driver.sock"];
  listenFD = SparkSandboxed() ? SparkListenSandboxed() : SparkListen(directoryFD, "driver.sock");
  if (listenFD < 0) SparkDriverRefuse([NSString stringWithFormat:@"Unable to listen on %@: %s", socketPath, strerror(errno)]);
  active = YES;
  driverStart = CACurrentMediaTime();
  quietPoints = [NSMutableArray new];
  processStart = SparkProcessStart();
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification object:nil queue:nil usingBlock:^(NSNotification *) {
    if (!didFinishLaunching) didFinishLaunching = CACurrentMediaTime();
  }];
  // React Native posts it on the JavaScript thread once the bundle has run (RCTInstance); a reload posts it again.
  [NSNotificationCenter.defaultCenter addObserverForName:@"RCTInstanceDidLoadBundle" object:nil queue:nil usingBlock:^(NSNotification *) {
    CFTimeInterval unset = 0;
    bundleLoaded.compare_exchange_strong(unset, CACurrentMediaTime());
  }];
  for (dispatch_block_t observer in SparkStartObservers()) observer();
  [SparkStartObservers() removeAllObjects];
  // Never take focus from the person using this Mac, and avoid App Nap timer throttling.
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep reason:@"Spark test driver"];
  SparkDriverInputStart();
  [NSThread detachNewThreadWithBlock:^{ SparkServe(); }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (authenticated) return;
    NSLog(@"Spark test driver: no authenticated client within 30 seconds");
    SparkDriverTerminate();
  });
  return YES;
}
