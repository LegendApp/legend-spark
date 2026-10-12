#import <AppKit/AppKit.h>
#import "SparkTestDriverPrivate.h"
#import "SparkDesktop.h"
#include <atomic>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

NSString *const SparkDesktopEvent = @"SparkDesktopEvent"; // SparkDesktop.mm's, which the harness does not link.
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
@interface DrawnView : NSView
@end
@implementation DrawnView
- (void)drawRect:(NSRect)rect { [NSColor.greenColor setFill]; NSRectFill(self.bounds); }
@end

// A React Native view as Spark's accessibility state patch leaves it: enabled and selected follow its
// accessibilityState (packages/config-plugin/accessibility-state.cjs).
@interface RCTViewComponentView : NSView
@property BOOL disabled, chosen;
@end
@implementation RCTViewComponentView
- (BOOL)isAccessibilityEnabled { return !self.disabled; }
- (BOOL)isAccessibilitySelected { return self.chosen; }
@end

// Two empty rows in a source list, the style the Sidebar uses; the first is selected.
@interface SourceList : NSObject <NSTableViewDataSource, NSTableViewDelegate>
@end
@implementation SourceList
- (NSInteger)numberOfRowsInTableView:(NSTableView *)tableView { return 2; }
- (NSView *)tableView:(NSTableView *)tableView viewForTableColumn:(NSTableColumn *)column row:(NSInteger)row { return nil; }
@end
static SourceList *sourceList;
static NSTableView *selectionTable;

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
static NSDictionary *Frame(int fd, NSString *testID) {
  NSDictionary *reply = Request(fd, @{ @"command": @"waitFor", @"testID": testID });
  Check([reply[@"ok"] boolValue], [@"waitFor " stringByAppendingString:testID]);
  return reply[@"frame"];
}
static void Client(void (^body)(void)) { [NSThread detachNewThreadWithBlock:body]; }

static NSWindow *MakeWindow(void) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)
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
  sourceList = [SourceList new];
  selectionTable = [NSTableView new];
  selectionTable.style = NSTableViewStyleSourceList; selectionTable.headerView = nil; selectionTable.rowHeight = 28;
  selectionTable.dataSource = sourceList; selectionTable.delegate = sourceList;
  [selectionTable addTableColumn:[[NSTableColumn alloc] initWithIdentifier:@"column"]];
  NSScrollView *list = [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 0, 400, 90)];
  list.documentView = selectionTable; list.drawsBackground = NO;
  for (NSView *view in @[layerColor, drawn, image, effect, button, label, list]) [content addSubview:view];
  window.contentView = content;
  [selectionTable reloadData];
  [selectionTable selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
  return window;
}
// Input targets (mode "input"): real AppKit controls plus views that record what they receive.
static std::atomic<int> buttonPresses{0}, sliderActions{0}, defaultPresses{0}, menuActions{0}, fieldActions{0}, refusedClicks{0};
static std::atomic<int> entered{0}, exited{0}, rightClicks{0}, flagChanges{0};
static std::atomic<bool> modalRunning{false}, stopModal{false}, presented{false};
static NSMutableArray<NSNumber *> *clickCounts;
static NSMutableArray<NSString *> *dragNumbers; // Event numbers a Draggable saw: down, drags, up.
static NSEvent *lastKey;
@interface Actions : NSObject
@end
@implementation Actions
- (void)button:(id)sender { buttonPresses++; }
- (void)slider:(id)sender { sliderActions++; }
- (void)defaultButton:(id)sender { defaultPresses++; }
- (void)menu:(id)sender { menuActions++; }
- (void)field:(id)sender { fieldActions++; }
// A modal loop the app enters in response to input, like a modal session; input-stop ends it.
- (void)modal:(id)sender {
  modalRunning = true;
  while (!stopModal) [NSRunLoop.mainRunLoop runMode:NSModalPanelRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
  modalRunning = false;
}
- (void)stop:(id)sender { stopModal = true; }
@end
@interface Recorder : NSView
@property BOOL refuses;
@end
@implementation Recorder
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return !self.refuses; }
- (BOOL)acceptsFirstResponder { return YES; }
- (void)mouseDown:(NSEvent *)event {
  if (self.refuses) refusedClicks++;
  presented = self.window.isVisible && self.window.alphaValue == 0 && self.window.ignoresMouseEvents && !self.window.isKeyWindow && !NSApp.isActive;
}
- (void)mouseUp:(NSEvent *)event { [clickCounts addObject:@(event.clickCount)]; }
- (void)rightMouseDown:(NSEvent *)event { rightClicks++; }
- (void)mouseEntered:(NSEvent *)event { entered++; }
- (void)mouseExited:(NSEvent *)event { exited++; }
- (void)keyDown:(NSEvent *)event { lastKey = event; }
- (void)flagsChanged:(NSEvent *)event { flagChanges++; }
@end
// Accepts the first mouse only when its acceptsFirstMouse property is set, as React Native views (RCTUIView) do.
@interface FirstMouseView : NSView
@property BOOL acceptsFirstMouse;
@property int presses;
@end
@implementation FirstMouseView
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return self.acceptsFirstMouse; }
- (void)mouseDown:(NSEvent *)event { self.presses++; }
@end
// Follows the pointer while dragged, like a draggable view in an app.
@interface Draggable : NSView
@end
@implementation Draggable
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event { [dragNumbers addObject:[NSString stringWithFormat:@"down %ld", (long)event.eventNumber]]; }
- (void)mouseDragged:(NSEvent *)event {
  [dragNumbers addObject:[NSString stringWithFormat:@"drag %ld", (long)event.eventNumber]];
  [self setFrameOrigin:NSMakePoint(self.frame.origin.x + event.deltaX, self.frame.origin.y - event.deltaY)];
}
- (void)mouseUp:(NSEvent *)event { [dragNumbers addObject:[NSString stringWithFormat:@"up %ld", (long)event.eventNumber]]; }
@end
static Actions *actions;
static NSWindow *MakeInputWindow(void) {
  actions = [Actions new]; clickCounts = [NSMutableArray new]; dragNumbers = [NSMutableArray new];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 500)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.identifier = @"input"; window.title = @"Input"; window.releasedWhenClosed = NO;
  NSView *content = window.contentView;
  content.wantsLayer = YES; content.layer.backgroundColor = NSColor.redColor.CGColor;
  auto add = ^(NSView *view, NSString *testID, NSRect frame) { view.frame = frame; view.accessibilityIdentifier = testID; [content addSubview:view]; };
  add([NSButton buttonWithTitle:@"Press" target:actions action:@selector(button:)], @"input-button", NSMakeRect(20, 440, 100, 32));
  NSSlider *slider = [NSSlider sliderWithValue:0 minValue:0 maxValue:100 target:actions action:@selector(slider:)];
  slider.continuous = YES;
  add(slider, @"input-slider", NSMakeRect(140, 444, 200, 24));
  NSTextField *field = [NSTextField textFieldWithString:@""]; field.target = actions; field.action = @selector(field:);
  add(field, @"input-field", NSMakeRect(360, 444, 200, 24));
  NSButton *defaultButton = [NSButton buttonWithTitle:@"OK" target:actions action:@selector(defaultButton:)]; defaultButton.keyEquivalent = @"\r";
  add(defaultButton, @"input-default", NSMakeRect(20, 390, 100, 32));
  add([NSButton buttonWithTitle:@"Modal" target:actions action:@selector(modal:)], @"input-modal", NSMakeRect(140, 390, 100, 32));
  // The modal loop's own window, as a modal session runs one: its button ends the loop.
  static NSPanel *panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 200, 100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  panel.identifier = @"input-panel"; panel.releasedWhenClosed = NO;
  NSButton *stop = [NSButton buttonWithTitle:@"Stop" target:actions action:@selector(stop:)];
  stop.frame = NSMakeRect(20, 20, 100, 32); stop.accessibilityIdentifier = @"input-stop";
  [panel.contentView addSubview:stop];
  Recorder *recorder = [Recorder new];
  add(recorder, @"input-recorder", NSMakeRect(20, 280, 100, 100));
  // As React Native views track hover. (An NSTrackingInVisibleRect area covers the visibleRect, which since macOS 14
  // extends past the bounds of views that do not clip.)
  [recorder addTrackingArea:[[NSTrackingArea alloc] initWithRect:recorder.bounds options:NSTrackingActiveAlways | NSTrackingMouseEnteredAndExited owner:recorder userInfo:nil]];
  Recorder *refuses = [Recorder new]; refuses.refuses = YES;
  add(refuses, @"input-refuses", NSMakeRect(140, 280, 100, 100));
  add([Draggable new], @"input-draggable", NSMakeRect(260, 280, 60, 60));
  add([FirstMouseView new], @"input-first-mouse", NSMakeRect(340, 280, 60, 60));
  NSPathControl *path = [NSPathControl new]; path.URL = [NSURL fileURLWithPath:@"/usr/bin"];
  add(path, @"input-path", NSMakeRect(20, 230, 300, 22));
  // An NSTabView's tab buttons are accessibility elements that are not views, like path components.
  NSTabView *tabs = [NSTabView new];
  for (NSString *name in @[@"One", @"Two"]) { NSTabViewItem *item = [[NSTabViewItem alloc] initWithIdentifier:name]; item.label = name; [tabs addTabViewItem:item]; }
  add(tabs, @"input-tabs", NSMakeRect(20, 90, 320, 120));
  // A host view and the native control it hosts share a testID, as Spark's React Native controls do.
  NSView *host = [NSView new];
  add(host, @"input-hosted", NSMakeRect(400, 280, 190, 40));
  NSButton *hosted = [NSButton buttonWithTitle:@"Hosted" target:actions action:@selector(button:)];
  hosted.frame = NSMakeRect(0, 5, 70, 30); hosted.accessibilityIdentifier = @"input-hosted";
  [host addSubview:hosted];
  NSScrollView *scroll = [NSScrollView new];
  scroll.documentView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 2000)];
  add(scroll, @"input-scroll", NSMakeRect(360, 20, 200, 200));
  [scroll.documentView scrollPoint:NSMakePoint(0, 1800)]; // The top of the (y-up) document.
  NSButton *deep = [NSButton buttonWithTitle:@"Deep" target:actions action:@selector(button:)];
  deep.frame = NSMakeRect(20, 100, 100, 32); deep.accessibilityIdentifier = @"input-deep"; // Scrolled out of view.
  [scroll.documentView addSubview:deep];
  NSView *covered = [NSButton buttonWithTitle:@"Covered" target:actions action:@selector(button:)];
  add(covered, @"input-covered", NSMakeRect(20, 20, 100, 32));
  NSView *cover = [NSView new];
  add(cover, @"input-cover", NSMakeRect(10, 10, 140, 60));
  NSMenu *menu = [NSMenu new], *file = [[NSMenu alloc] initWithTitle:@"File"];
  NSMenuItem *top = [NSMenuItem new]; top.submenu = file; [menu addItem:top];
  [file addItemWithTitle:@"Act" action:@selector(menu:) keyEquivalent:@"k"].target = actions;
  // Like the system's Globe-key items (Fn-E Emoji & Symbols): NSMenu ignores the Function flag when matching.
  NSMenuItem *globe = [file addItemWithTitle:@"Globe" action:@selector(menu:) keyEquivalent:@"j"];
  globe.target = actions; globe.keyEquivalentModifierMask = NSEventModifierFlagFunction;
  NSApp.mainMenu = menu;
  return window;
}
// Gesture and cursor targets (mode "pointer").
static NSMutableArray<NSString *> *gestures;
static NSMutableSet<NSValue *> *gestureLocations; // locationInWindow of every gesture and pressure event.
@interface GestureRecorder : NSView
@end
@implementation GestureRecorder
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event { [gestures addObject:@"down"]; }
- (void)mouseUp:(NSEvent *)event { [gestures addObject:@"up"]; }
- (void)otherMouseDown:(NSEvent *)event { [gestures addObject:[NSString stringWithFormat:@"otherDown %ld", (long)event.buttonNumber]]; }
- (void)otherMouseUp:(NSEvent *)event { [gestures addObject:[NSString stringWithFormat:@"otherUp %ld", (long)event.buttonNumber]]; }
- (void)magnifyWithEvent:(NSEvent *)event { [gestureLocations addObject:[NSValue valueWithPoint:event.locationInWindow]]; [gestures addObject:[NSString stringWithFormat:@"magnify %g %lu", event.magnification, (unsigned long)event.phase]]; }
- (void)rotateWithEvent:(NSEvent *)event { [gestureLocations addObject:[NSValue valueWithPoint:event.locationInWindow]]; [gestures addObject:[NSString stringWithFormat:@"rotate %g %lu", event.rotation, (unsigned long)event.phase]]; }
- (void)swipeWithEvent:(NSEvent *)event { [gestureLocations addObject:[NSValue valueWithPoint:event.locationInWindow]]; [gestures addObject:[NSString stringWithFormat:@"swipe %g %g", event.deltaX, event.deltaY]]; }
- (void)smartMagnifyWithEvent:(NSEvent *)event { [gestureLocations addObject:[NSValue valueWithPoint:event.locationInWindow]]; [gestures addObject:@"smartMagnify"]; }
- (void)pressureChangeWithEvent:(NSEvent *)event { [gestureLocations addObject:[NSValue valueWithPoint:event.locationInWindow]]; [gestures addObject:[NSString stringWithFormat:@"pressure %ld %g %g", (long)event.stage, event.pressure, event.stageTransition]]; }
- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor]; }
@end
// Sets its cursor from -cursorUpdate:, as views with an NSTrackingCursorUpdate area do.
@interface UpdateCursorView : NSView
@end
@implementation UpdateCursorView
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (!self.trackingAreas.count) [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingCursorUpdate | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil]];
}
- (void)cursorUpdate:(NSEvent *)event { [NSCursor.crosshairCursor set]; }
@end
static NSWindow *MakePointerWindow(void) {
  gestures = [NSMutableArray new]; gestureLocations = [NSMutableSet new];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.identifier = @"pointer"; window.releasedWhenClosed = NO;
  auto add = ^(NSView *view, NSString *testID, NSRect frame) { view.frame = frame; view.accessibilityIdentifier = testID; [window.contentView addSubview:view]; };
  add([GestureRecorder new], @"pointer-gestures", NSMakeRect(20, 150, 150, 120));
  UpdateCursorView *update = [UpdateCursorView new];
  add(update, @"pointer-update", NSMakeRect(200, 150, 150, 120));
  [update updateTrackingAreas];
  add([NSTextField textFieldWithString:@""], @"pointer-field", NSMakeRect(20, 100, 200, 24));
  add([NSView new], @"pointer-plain", NSMakeRect(20, 20, 100, 60));
  return window;
}
static id OnMain(id (^read)(void)) { __block id value; dispatch_sync(dispatch_get_main_queue(), ^{ value = read(); }); return value; }

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

// Validates its items off, as a responder with nothing to act on would.
@interface MenuValidator : NSObject @end
@implementation MenuValidator
- (void)act:(id)sender {}
- (BOOL)validateMenuItem:(NSMenuItem *)item { return NO; }
@end
static MenuValidator *validator;
static void MakeMenu(void) {
  NSMenu *main = [NSMenu new], *file = [[NSMenu alloc] initWithTitle:@"File"];
  NSMenuItem *fileItem = [main addItemWithTitle:@"File" action:nil keyEquivalent:@""]; fileItem.submenu = file;
  validator = [MenuValidator new];
  NSMenuItem *save = [file addItemWithTitle:@"Save" action:@selector(act:) keyEquivalent:@"s"]; save.target = validator; save.identifier = @"save";
  [file addItem:NSMenuItem.separatorItem];
  NSMenuItem *show = [file addItemWithTitle:@"Show" action:nil keyEquivalent:@"z"];
  show.keyEquivalentModifierMask = NSEventModifierFlagControl | NSEventModifierFlagCommand; show.hidden = YES; show.toolTip = @"Hidden"; show.state = NSControlStateValueOn;
  NSApp.mainMenu = main;
}
int main(int argc, char **argv) { @autoreleasepool {
  NSString *mode = argc > 1 ? @(argv[1]) : @"";
  openedURLs = [NSMutableArray new]; pending = [NSMutableData new];
  [NSApplication sharedApplication];
  Delegate *delegate = [Delegate new]; NSApp.delegate = delegate;
  if ([mode isEqual:@"inert"]) {
    unsetenv("SPARK_TEST_DRIVER_DIR");
    __block BOOL observed = NO;
    SparkTestDriverObserveStart(^{ observed = YES; });
    Check(!SparkTestDriverStart() && !SparkTestDriverActive(), @"driver starts without the runner");
    Check(!observed, @"start observers never run outside driver mode");
    puts("inert passed"); return 0;
  }
  if ([mode isEqual:@"refuse-directory"]) { PrepareDirectory(argv[2], 0755, 0600); SparkTestDriverStart(); return 0; }
  if ([mode isEqual:@"refuse-token"]) { PrepareDirectory(argv[2], 0700, 0644); SparkTestDriverStart(); return 0; }
  PrepareDirectory(argv[2], 0700, 0600);
  NSWindow *window = MakeWindow();
  MakeMenu();
  // Modules register before the driver starts (from +load); a late registration runs at once.
  __block int early = 0, late = 0;
  SparkTestDriverObserveStart(^{ early += SparkTestDriverActive() ? 1 : 100; });
  Check(early == 0, @"start observers wait for the driver");
  Check(SparkTestDriverStart() && SparkTestDriverActive(), @"driver start");
  SparkTestDriverObserveStart(^{ late++; });
  Check(early == 1 && late == 1, @"start observers run once, with the driver active");
  // Optional modules add commands; built-in and duplicate names are refused.
  SparkTestDriverRegisterCommand(@"echo", ^(NSDictionary *request, SparkTestDriverReply reply) { reply(@{ @"ok": @YES, @"echo": request[@"value"] ?: NSNull.null }); });
  for (NSString *taken in @[@"ping", @"openFile", @"tap", @"echo"]) {
    BOOL refused = NO;
    @try { SparkTestDriverRegisterCommand(taken, ^(NSDictionary *, SparkTestDriverReply reply) { reply(@{ @"ok": @NO }); }); } @catch (NSException *) { refused = YES; }
    Check(refused, [NSString stringWithFormat:@"%@ cannot be registered twice", taken]);
  }
  if ([mode isEqual:@"startup"]) {
    // The host's launch: AppKit finishes launching, then React Native runs the bundle on its JavaScript thread.
    [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidFinishLaunchingNotification object:NSApp];
    NSThread *javascript = [[NSThread alloc] initWithBlock:^{ [NSNotificationCenter.defaultCenter postNotificationName:@"RCTInstanceDidLoadBundle" object:nil]; }];
    [javascript start];
    Pump(^{ return javascript.finished; }, 5);
  }
  if (![mode isEqual:@"startup"]) SparkTestDriverDidMount(); // The host's first UI mount.
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
    Check([Request(fd, @{ @"command": @"echo", @"value": @3 })[@"echo"] isEqual:@3], @"registered module command");
    NSArray *menus = Request(fd, @{ @"command": @"menus" })[@"menus"];
    NSArray *fileMenu = [menus.firstObject[@"title"] isEqual:@"File"] ? menus.firstObject[@"items"] : nil;
    Check(fileMenu.count == 3 && [fileMenu[1][@"separator"] boolValue], [NSString stringWithFormat:@"menus lists the menu bar: %@", menus]);
    Check([fileMenu[0][@"id"] isEqual:@"save"] && ![fileMenu[0][@"enabled"] boolValue] && [fileMenu[0][@"shortcut"][@"key"] isEqual:@"s"] && [fileMenu[0][@"shortcut"][@"modifiers"] isEqual:@(NSEventModifierFlagCommand)], @"menus validates items before reporting them");
    Check([fileMenu[2][@"hidden"] boolValue] && [fileMenu[2][@"state"] isEqual:@"on"] && [fileMenu[2][@"toolTip"] isEqual:@"Hidden"] && [fileMenu[2][@"shortcut"][@"modifiers"] isEqual:@(NSEventModifierFlagControl | NSEventModifierFlagCommand)], @"menus reports hidden items, state, tooltips and modifiers");
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
    Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
    Check(Receive(fd) == nil, @"quit ends the session");
    finished = YES;
  });
  else if ([mode isEqual:@"input"]) {
    NSWindow *input = MakeInputWindow();
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      auto ok = ^(NSDictionary *request) {
        NSDictionary *reply = Request(fd, request);
        Check([reply[@"ok"] boolValue], [NSString stringWithFormat:@"%@: %@", request, reply]);
      };
      auto center = ^(NSString *testID, CGFloat fx, CGFloat fy) {
        NSDictionary *frame = Frame(fd, testID);
        return @{ @"x": @([frame[@"x"] doubleValue] + [frame[@"width"] doubleValue] * fx), @"y": @([frame[@"y"] doubleValue] + [frame[@"height"] doubleValue] * fy) };
      };
      // The in-process accessibility view that selectors other than testID match against.
      NSDictionary *tree = Request(fd, @{ @"command": @"elements" });
      NSArray *elements = tree[@"elements"];
      NSDictionary *button = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"id == 'input-button'"]].firstObject;
      Check([button[@"role"] isEqual:@"button"] && [button[@"text"] isEqual:@"Press"] && [button[@"window"] isEqual:@"input"], [NSString stringWithFormat:@"elements: a button (%@)", button]);
      NSDictionary *probe = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"id == 'probe-layer'"]].firstObject;
      Check([probe[@"frame"] isEqual:Frame(fd, @"probe-layer")] && [probe[@"window"] isEqual:@"spark.main"], @"elements: frames as waitFor reports them");
      NSDictionary *label = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"text == 'Label'"]].firstObject;
      Check([label[@"role"] isEqual:@"staticText"] && label[@"parent"] == nil, [NSString stringWithFormat:@"elements: a label's text (%@)", label]);
      NSArray *hostedElements = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"id == 'input-hosted'"]];
      Check(hostedElements.count == 1 && [hostedElements[0][@"role"] isEqual:@"button"] && [hostedElements[0][@"text"] isEqual:@"Hosted"] && [hostedElements[0][@"frame"][@"width"] isEqual:@70],
        [NSString stringWithFormat:@"elements: a hosted control with its host's testID is one element (%@)", hostedElements]);
      NSDictionary *pathElement = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"id == 'input-path'"]].firstObject;
      NSArray *components = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"text == 'usr'"]];
      Check(components.count == 1 && [components[0][@"window"] isEqual:@"input"] && [components[0][@"frame"][@"x"] doubleValue] >= [pathElement[@"frame"][@"x"] doubleValue],
        [NSString stringWithFormat:@"elements: accessibility parts of a control that are not views, such as path components (%@)", components]);
      NSArray *tabButtons = [elements filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"role == 'radioButton' AND window == 'input'"]];
      NSDictionary *two = [tabButtons filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"label == 'Two' OR text == 'Two'"]].firstObject;
      Check(tabButtons.count == 2 && two != nil, [NSString stringWithFormat:@"elements: tab view tab buttons (%@)", tabButtons]);
      NSArray *windowIDs = [tree[@"windows"] valueForKey:@"id"];
      Check([windowIDs containsObject:@"input"] && [windowIDs containsObject:@"spark.main"], [NSString stringWithFormat:@"elements: windows (%@)", windowIDs]);
      NSSlider *slider = OnMain(^{ return SparkDriverFindView(@"input-slider"); });
      // A point from waitFor's frame (top-left points of the frame view) lands where the frame says.
      ok(@{ @"command": @"tap", @"window": @"id:input", @"point": center(@"input-slider", 0.75, 0.5) });
      double value = [OnMain(^{ return @(slider.doubleValue); }) doubleValue];
      Check(fabs(value - 75) < 4, [NSString stringWithFormat:@"a tap at 75%% of the slider sets it near 75 (%.1f)", value]);
      Check([OnMain(^{ return @(!input.isVisible && input.alphaValue == 1 && !input.ignoresMouseEvents); }) boolValue], @"the window is off screen again after pointer input");
      // AppKit gives a window ordered in without a first responder its first key view, on every order-in (#371); the
      // driver must not. A click on an AppKit control in a window that is not key takes no focus either.
      auto unfocused = ^{
        NSString *focused = OnMain(^{ return input.firstResponder == input ? @"window" : NSStringFromClass(input.firstResponder.class); });
        Check([focused isEqual:@"window"], [NSString stringWithFormat:@"ordering a window in for pointer input gives no view keyboard focus (%@)", focused]);
      };
      unfocused();
      NSDictionary *twoFrame = two[@"frame"];
      ok(@{ @"command": @"tap", @"window": @"id:input", @"point": @{ @"x": @([twoFrame[@"x"] doubleValue] + [twoFrame[@"width"] doubleValue] / 2), @"y": @([twoFrame[@"y"] doubleValue] + [twoFrame[@"height"] doubleValue] / 2) } });
      NSString *selectedTab = OnMain(^{ return [((NSTabView *)SparkDriverFindView(@"input-tabs")).selectedTabViewItem.identifier description]; });
      Check([selectedTab isEqual:@"Two"], [NSString stringWithFormat:@"a tap on a tab button at its elements frame selects the tab (%@)", selectedTab]);
      unfocused();
      ok(@{ @"command": @"tap", @"testID": @"input-button" });
      Check(buttonPresses == 1, @"a tap presses an NSButton (its tracking loop takes the queued mouseUp)");
      int before = sliderActions;
      ok(@{ @"command": @"drag", @"from": @{ @"point": center(@"input-slider", 0.25, 0.5) }, @"to": @{ @"point": center(@"input-slider", 1, 0.5) }, @"window": @"id:input", @"steps": @10 });
      Check([OnMain(^{ return @(slider.doubleValue); }) doubleValue] == 100 && sliderActions - before >= 5, @"a drag moves a continuous slider through intermediate values");
      NSView *draggable = OnMain(^{ return SparkDriverFindView(@"input-draggable"); });
      NSDictionary *from = center(@"input-draggable", 0.5, 0.5);
      ok(@{ @"command": @"drag", @"from": @{ @"testID": @"input-draggable" }, @"to": @{ @"point": @{ @"x": @([from[@"x"] doubleValue] + 50), @"y": @([from[@"y"] doubleValue] + 30) } }, @"window": @"id:input" });
      NSPoint origin = [OnMain(^{ return [NSValue valueWithPoint:draggable.frame.origin]; }) pointValue];
      Check(NSEqualPoints(origin, NSMakePoint(310, 250)), [NSString stringWithFormat:@"a drag moves a view by the pointer's travel (%@)", NSStringFromPoint(origin)]);
      NSArray *numbers = OnMain(^{ return [dragNumbers copy]; });
      NSString *number = [[numbers.firstObject componentsSeparatedByString:@" "] lastObject];
      Check(numbers.count == 12 && [numbers.firstObject hasPrefix:@"down"] && [numbers.lastObject hasPrefix:@"up"] &&
        [[numbers filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"SELF ENDSWITH %@", [@" " stringByAppendingString:number]]] count] == 12,
        [NSString stringWithFormat:@"a press, its drags and its release share one event number, as React Native expects (%@)", numbers]);
      ok(@{ @"command": @"tap", @"testID": @"input-recorder", @"clickCount": @2 });
      Check([OnMain(^{ return [clickCounts copy]; }) isEqual:(@[@1, @2])], @"a double click is two clicks with click counts 1 and 2");
      Check(presented, @"during pointer input the window is on screen, transparent, ignoring real mouse events, not key, and the app inactive");
      ok(@{ @"command": @"tap", @"testID": @"input-recorder", @"button": @"right" });
      Check(rightClicks == 1, @"a right click");
      Check(entered == 1 && exited == 0, @"moving onto a view enters its tracking area once");
      ok(@{ @"command": @"hover", @"testID": @"input-button" });
      Check(exited == 1, @"hovering elsewhere exits it");
      ok(@{ @"command": @"hover", @"testID": @"input-recorder" });
      Check(entered == 2, @"hover enters it again");
      ok(@{ @"command": @"tap", @"testID": @"input-refuses" });
      Check(refusedClicks == 0, @"a view that refuses first mouse ignores clicks, as in any inactive app");
      FirstMouseView *firstMouse = OnMain(^{ return SparkDriverFindView(@"input-first-mouse"); });
      ok(@{ @"command": @"tap", @"testID": @"input-first-mouse" });
      Check([OnMain(^{ return @(firstMouse.presses == 1 && !firstMouse.acceptsFirstMouse); }) boolValue], @"a view with an acceptsFirstMouse property (React Native) gets the click, and the property is restored");
      NSScrollView *scroll = OnMain(^{ return SparkDriverFindView(@"input-scroll"); });
      ok(@{ @"command": @"scroll", @"testID": @"input-scroll", @"deltaY": @100, @"precise": @YES });
      double offset = [OnMain(^{ return @(scroll.contentView.bounds.origin.y); }) doubleValue];
      Check(offset == 1700, [NSString stringWithFormat:@"a precise scroll moves 100 points toward the end (%.1f)", offset]);
      ok(@{ @"command": @"scroll", @"testID": @"input-scroll", @"deltaY": @-3 });
      Check([OnMain(^{ return @(scroll.contentView.bounds.origin.y); }) doubleValue] > 1700, @"a line scroll moves back toward the start");
      // As in XCUITest and Playwright, a testID target is scrolled into view, and must not be covered.
      int pressed = buttonPresses;
      ok(@{ @"command": @"tap", @"testID": @"input-deep" });
      Check(buttonPresses == pressed + 1, @"a target scrolled out of view is scrolled into view and pressed");
      Check([Code(Request(fd, @{ @"command": @"tap", @"testID": @"input-covered" })) isEqual:@"E_NOT_HITTABLE"] && buttonPresses == pressed + 1, @"a covered target is not clicked");
      ok(@{ @"command": @"tap", @"testID": @"input-hosted" });
      Check(buttonPresses == pressed + 2, @"a testID shared by a host and its control addresses the control, as elements reports it");
      ok(@{ @"command": @"tap", @"testID": @"input-slider", @"offset": @{ @"x": @50, @"y": @12 } });
      double quarter = [OnMain(^{ return @(slider.doubleValue); }) doubleValue];
      Check(fabs(quarter - 25) < 4, [NSString stringWithFormat:@"offset is points from the target's top-left (%.1f)", quarter]);
      // Keys go to the window of the last pointer input, through its first responder.
      NSTextField *field = OnMain(^{ return SparkDriverFindView(@"input-field"); });
      ok(@{ @"command": @"tap", @"testID": @"input-field" });
      ok(@{ @"command": @"typeText", @"text": @"Héj😀 1+" });
      NSString *typed = OnMain(^{ return field.currentEditor.string ?: field.stringValue; });
      Check([typed isEqual:@"Héj😀 1+"], [NSString stringWithFormat:@"typeText types IME-free Unicode (%@)", typed]);
      Check(menuActions == 0, @"a plain j is typed, not taken by a Fn-J menu item");
      ok(@{ @"command": @"pressKey", @"key": @"\x7f" });
      Check([OnMain(^{ return field.currentEditor.string; }) isEqual:@"Héj😀 1"], @"Backspace deletes a character");
      ok(@{ @"command": @"typeText", @"text": @"\n" });
      Check(defaultPresses == 1, @"Return presses the default button, as for a key window");
      ok(@{ @"command": @"pressKey", @"key": @"k", @"modifiers": @[@"cmd"] });
      Check(menuActions == 1, @"a key equivalent fires its main menu item");
      ok(@{ @"command": @"tap", @"testID": @"input-recorder" });
      ok(@{ @"command": @"pressKey", @"key": @"\uf700" });
      NSEvent *up = OnMain(^{ return lastKey; });
      Check(up.keyCode == 126 && (up.modifierFlags & NSEventModifierFlagFunction) && (up.modifierFlags & NSEventModifierFlagNumericPad), @"arrow keys carry their key code and hardware flags");
      ok(@{ @"command": @"pressKey", @"key": @"s", @"modifiers": @[@"shift", @"option"] });
      NSEvent *shifted = OnMain(^{ return lastKey; });
      Check([shifted.charactersIgnoringModifiers isEqual:@"S"] && shifted.keyCode == 1 && flagChanges == 4 &&
        (shifted.modifierFlags & NSEventModifierFlagShift) && (shifted.modifierFlags & NSEventModifierFlagOption), @"modifiers are pressed (flagsChanged) around the key");
      // A command that leaves the app in a modal loop replies, and later requests run inside the loop.
      ok(@{ @"command": @"tap", @"testID": @"input-modal" });
      Check(modalRunning, @"the tap replies while the modal loop it started runs");
      ok(@{ @"command": @"ping" });
      ok(@{ @"command": @"capture", @"window": @"id:input", @"name": @"input" });
      ok(@{ @"command": @"tap", @"testID": @"input-stop" });
      for (int n = 0; n < 100 && modalRunning; n++) usleep(10000);
      Check(!modalRunning, @"input inside the modal loop ends it");
      Check([Code(Request(fd, @{ @"command": @"tap", @"testID": @"input-button", @"point": @{ @"x": @1, @"y": @1 } })) isEqual:@"E_INVALID_ARGUMENT"], @"testID or point");
      Check([Code(Request(fd, @{ @"command": @"tap", @"testID": @"missing" })) isEqual:@"E_NOT_FOUND"], @"unknown testIDs fail");
      Check([Code(Request(fd, @{ @"command": @"tap", @"window": @"id:input", @"point": @{ @"x": @-1, @"y": @1 } })) isEqual:@"E_INVALID_ARGUMENT"], @"points outside the window fail");
      Check([Code(Request(fd, @{ @"command": @"tap", @"window": @"id:none", @"point": @{ @"x": @1, @"y": @1 } })) isEqual:@"E_NO_WINDOW"], @"unknown windows fail");
      Check([Code(Request(fd, @{ @"command": @"pressKey", @"key": @"ab" })) isEqual:@"E_INVALID_ARGUMENT"], @"one key per press");
      Check([Code(Request(fd, @{ @"command": @"pressKey", @"key": @"a", @"modifiers": @[@"hyper"] })) isEqual:@"E_INVALID_ARGUMENT"], @"unknown modifiers fail");
      Check([Code(Request(fd, @{ @"command": @"scroll", @"testID": @"input-scroll" })) isEqual:@"E_INVALID_ARGUMENT"], @"scroll needs a delta");
      Check([OnMain(^{ return @(!NSApp.isActive && !NSApp.keyWindow && NSApp.activationPolicy == NSApplicationActivationPolicyProhibited); }) boolValue], @"input never activates the app");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"pointer"]) {
    NSWindow *pointerWindow = MakePointerWindow();
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      auto ok = ^NSDictionary *(NSDictionary *request) {
        NSDictionary *reply = Request(fd, request);
        Check([reply[@"ok"] boolValue], [NSString stringWithFormat:@"%@: %@", request, reply]);
        return reply;
      };
      auto take = ^NSArray *{ return OnMain(^{ NSArray *seen = [gestures copy]; [gestures removeAllObjects]; return seen; }); };
      auto expect = ^(NSArray *expected, NSString *what) { NSArray *seen = take(); Check([seen isEqual:expected], [NSString stringWithFormat:@"%@ (%@)", what, seen]); };
      // The cursor AppKit would show, from cursor rects and cursor updates, without changing the real one. (First: pointer input orders the window in, where its text field becomes first responder.)
      auto cursor = ^NSDictionary *(NSString *testID) { return ok(testID ? @{ @"command": @"cursor", @"testID": testID } : @{ @"command": @"cursor" }); };
      Check([cursor(@"pointer-gestures")[@"cursor"] isEqual:@"pointingHand"], @"a cursor rect");
      Check([cursor(@"pointer-update")[@"cursor"] isEqual:@"crosshair"], @"a cursor set from -cursorUpdate:");
      Check([cursor(@"pointer-field")[@"cursor"] isEqual:@"IBeam"], @"a text field's I-beam");
      Check([cursor(@"pointer-plain")[@"cursor"] isEqual:@"arrow"], @"the arrow elsewhere");
      Check([cursor(@"pointer-gestures")[@"cursor"] isEqual:@"pointingHand"], @"asking again finds the same cursor rect");
      NSDictionary *target = @{ @"testID": @"pointer-gestures" };
      auto gesture = ^(NSDictionary *fields) { NSMutableDictionary *request = [target mutableCopy]; request[@"command"] = @"gesture"; [request addEntriesFromDictionary:fields]; ok(request); };
      gesture(@{ @"kind": @"magnify", @"magnification": @0.5, @"steps": @2 });
      expect(@[@"magnify 0 1", @"magnify 0.25 4", @"magnify 0.25 4", @"magnify 0 8"], @"magnify begins, changes in equal steps and ends at the view under the pointer");
      gesture(@{ @"kind": @"rotate", @"rotation": @-30, @"steps": @3 });
      expect(@[@"rotate 0 1", @"rotate -10 4", @"rotate -10 4", @"rotate -10 4", @"rotate 0 8"], @"rotate in degrees, counterclockwise positive");
      for (NSArray *swipe in @[@[@"left", @"swipe 1 0"], @[@"right", @"swipe -1 0"], @[@"up", @"swipe 0 1"], @[@"down", @"swipe 0 -1"]]) {
        gesture(@{ @"kind": @"swipe", @"direction": swipe[0] });
        expect(@[swipe[1]], [NSString stringWithFormat:@"a %@ swipe has AppKit's deltas (left and up are positive)", swipe[0]]);
      }
      gesture(@{ @"kind": @"smartMagnify" });
      expect(@[@"smartMagnify"], @"smart magnify");
      gesture(@{ @"kind": @"pressure" });
      expect(@[@"down", @"pressure 1 0.25 0", @"pressure 1 0.5 0", @"pressure 1 1 0.5", @"pressure 2 0.5 0", @"pressure 0 0 0", @"up"], @"a force click: pressure rises through stage 1 into stage 2 between press and release");
      gesture(@{ @"kind": @"pressure", @"stage": @1 });
      expect(@[@"down", @"pressure 1 0.25 0", @"pressure 1 0.5 0", @"pressure 1 1 0", @"pressure 0 0 0", @"up"], @"a stage 1 pressure click never reaches stage 2");
      NSValue *center = OnMain(^{ NSView *view = SparkDriverFindView(@"pointer-gestures"); return [NSValue valueWithPoint:[view convertPoint:NSMakePoint(NSMidX(view.bounds), NSMidY(view.bounds)) toView:nil]]; });
      NSSet *locations = OnMain(^{ return [gestureLocations copy]; });
      Check([locations isEqual:[NSSet setWithObject:center]], [NSString stringWithFormat:@"every gesture arrives at the target's center in window coordinates (%@ at %@)", locations, center]);
      ok(@{ @"command": @"tap", @"testID": @"pointer-gestures", @"button": @"back" });
      ok(@{ @"command": @"tap", @"testID": @"pointer-gestures", @"button": @"forward" });
      expect(@[@"otherDown 3", @"otherUp 3", @"otherDown 4", @"otherUp 4"], @"back and forward are mouse buttons 3 and 4");
      Check([Code(Request(fd, @{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"pinch" })) isEqual:@"E_INVALID_ARGUMENT"], @"unknown gestures fail");
      Check([Code(Request(fd, @{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"magnify" })) isEqual:@"E_INVALID_ARGUMENT"], @"magnify needs a magnification");
      Check([Code(Request(fd, @{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"magnify", @"magnification": @-1 })) isEqual:@"E_INVALID_ARGUMENT"], @"magnify cannot shrink to nothing");
      Check([Code(Request(fd, @{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"swipe", @"direction": @"in" })) isEqual:@"E_INVALID_ARGUMENT"], @"swipe needs a direction");
      Check([Code(Request(fd, @{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"pressure", @"stage": @3 })) isEqual:@"E_INVALID_ARGUMENT"], @"pressure stages are 1 and 2");
      Check([Code(Request(fd, @{ @"command": @"tap", @"testID": @"pointer-gestures", @"button": @"middle" })) isEqual:@"E_INVALID_ARGUMENT"], @"unknown buttons fail");
      ok(@{ @"command": @"tap", @"testID": @"pointer-field" });
      ok(@{ @"command": @"typeText", @"text": @"a" });
      NSDictionary *typing = cursor(nil);
      // While a field is edited outside the key window, AppKit gives its field editor a copy of the arrow.
      Check([typing[@"cursor"] isEqual:@"arrow"] && [typing[@"hiddenUntilMoved"] boolValue], [NSString stringWithFormat:@"typing hides the cursor until it moves, recorded at the driver's pointer (%@)", typing]);
      ok(@{ @"command": @"hover", @"testID": @"pointer-plain" });
      Check(![cursor(nil)[@"hiddenUntilMoved"] boolValue], @"a pointer move ends it");
      OnMain(^{ [NSCursor setHiddenUntilMouseMoves:YES]; return (id)nil; });
      Check([cursor(nil)[@"hiddenUntilMoved"] boolValue], @"the app's own +[NSCursor setHiddenUntilMouseMoves:] is recorded");
      Check([OnMain(^{ return @(!NSApp.isActive && !pointerWindow.isVisible); }) boolValue], @"pointer input never activates the app and leaves the window off screen");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  // Built without SPARK_TEST_DRIVER_PRIVATE_EVENTS, as an app that does not opt in: gestures and extra mouse buttons
  // fail with a typed error, while the rest of the input still works.
  else if ([mode isEqual:@"pointer-off"]) {
    MakePointerWindow();
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      for (NSDictionary *request in @[@{ @"command": @"gesture", @"testID": @"pointer-gestures", @"kind": @"smartMagnify" },
                                      @{ @"command": @"tap", @"testID": @"pointer-gestures", @"button": @"back" }]) {
        NSDictionary *reply = Request(fd, request);
        Check([Code(reply) isEqual:@"E_UNSUPPORTED"] && [reply[@"error"][@"message"] containsString:@"SPARK_TEST_DRIVER_PRIVATE_EVENTS"],
          [NSString stringWithFormat:@"%@ fails naming the missing build flag (%@)", request[@"command"], reply]);
      }
      Check([OnMain(^{ return @(gestures.count); }) integerValue] == 0, @"nothing reached the view");
      Check([Request(fd, @{ @"command": @"tap", @"testID": @"pointer-gestures" })[@"ok"] boolValue] && [OnMain(^{ return [gestures copy]; }) isEqual:(@[@"down", @"up"])], @"left clicks still work");
      Check([Request(fd, @{ @"command": @"cursor", @"testID": @"pointer-gestures" })[@"cursor"] isEqual:@"pointingHand"], @"cursor queries still work");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"menu"]) {
    // A context menu would track the real pointer and keyboard: the driver closes it and fails the command.
    NSView *menuView = [[NSView alloc] initWithFrame:NSMakeRect(250, 20, 100, 60)];
    menuView.accessibilityIdentifier = @"menu-view";
    menuView.menu = [[NSMenu alloc] initWithTitle:@"Context"];
    [menuView.menu addItemWithTitle:@"Item" action:nil keyEquivalent:@""];
    [window.contentView addSubview:menuView];
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      NSDictionary *reply = Request(fd, @{ @"command": @"tap", @"testID": @"menu-view", @"button": @"right" });
      Check([Code(reply) isEqual:@"E_MENU"], [NSString stringWithFormat:@"a right click that opens a context menu fails with E_MENU (%@)", reply]);
      Check([Request(fd, @{ @"command": @"ping" })[@"ok"] boolValue], @"the session continues after the menu closed");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"hooks"]) {
    // Module hooks: input observers run before input and deep links; render wrappers run around every capture.
    static std::atomic<int> inputs{0};
    SparkTestDriverObserveInput(^{ inputs++; });
    NSView *probe = SparkTestDriverFindView(@"probe-layer");
    Check(probe && SparkTestDriverFindView(@"missing") == nil, @"modules find views by testID");
    SparkTestDriverWrapRender(^(dispatch_block_t render) {
      probe.layer.backgroundColor = NSColor.blueColor.CGColor;  // what a module presents only while rendering
      render();
      probe.layer.backgroundColor = NSColor.redColor.CGColor;
    });
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      Check([Request(fd, @{ @"command": @"ping" })[@"ok"] boolValue] && inputs == 0, @"ping is not input");
      Check([Request(fd, @{ @"command": @"navigate", @"url": @"spark-ks://hooks" })[@"ok"] boolValue] && inputs == 1, @"navigate is input");
      Check([Request(fd, @{ @"command": @"capture", @"window": @"main", @"name": @"wrapped" })[@"ok"] boolValue], @"capture");
      Check(Near(OnMain(^{ return [NSColor colorWithCGColor:probe.layer.backgroundColor]; }), 1, 0, 0), @"the wrapper restored the view after rendering");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"frames"]) {
    // Frame counting: the display link counts frames; a blocked main thread drops them. It needs a display whose link
    // ticks; without one the commands fail E_UNAVAILABLE, and this mode says why it skipped.
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      Check([Code(Request(fd, @{ @"command": @"stopFrames" })) isEqual:@"E_INVALID_STATE"], @"stopFrames needs startFrames");
      NSDictionary *started = Request(fd, @{ @"command": @"startFrames" });
      NSDictionary *idle = nil;
      if ([started[@"ok"] boolValue]) {
        Check([started[@"refreshRate"] intValue] >= 30, [NSString stringWithFormat:@"startFrames %@", started]);
        Check([Code(Request(fd, @{ @"command": @"startFrames" })) isEqual:@"E_BUSY"], @"one frame count at a time");
        usleep(500000);
        idle = Request(fd, @{ @"command": @"stopFrames" });
      }
      NSDictionary *unavailable = [Code(started) isEqual:@"E_UNAVAILABLE"] ? started : [Code(idle) isEqual:@"E_UNAVAILABLE"] ? idle : nil;
      if (unavailable) {
        printf("frames skipped: %s\n", [unavailable[@"error"][@"message"] UTF8String]);
        Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
        finished = YES;
        return;
      }
      // Loose on purpose: a loaded machine delivers fewer callbacks than the display's rate.
      const double expected = 0.5 * [started[@"refreshRate"] doubleValue];
      Check([idle[@"ok"] boolValue] && [idle[@"frames"] doubleValue] > expected * 0.25 && [idle[@"fps"] doubleValue] > [started[@"refreshRate"] doubleValue] * 0.25,
        [NSString stringWithFormat:@"an idle main thread keeps roughly the display's cadence: %@", idle]);
      Request(fd, @{ @"command": @"startFrames" });
      usleep(100000);
      dispatch_async(dispatch_get_main_queue(), ^{ usleep(250000); });
      usleep(400000);
      NSDictionary *blocked = Request(fd, @{ @"command": @"stopFrames" });
      Check([blocked[@"ok"] boolValue] && [blocked[@"droppedFrames"] doubleValue] >= 0.2 * [started[@"refreshRate"] doubleValue] && [blocked[@"maxFrameGapMs"] doubleValue] >= 240,
        [NSString stringWithFormat:@"a blocked main thread drops frames: %@", blocked]);
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"startup"]) {
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      NSDictionary *early = Request(fd, @{ @"command": @"startup", @"timeoutMs": @0 });
      Check([Code(early) isEqual:@"E_TIMEOUT"] && [early[@"error"][@"message"] isEqual:@"The app has not mounted UI before the timeout"], [NSString stringWithFormat:@"startup waits for the first UI: %@", early]);
      // A quiet UI without elements (views with a testID) has not finished starting.
      NSView *probe = OnMain(^{ return SparkTestDriverFindView(@"probe-layer"); });
      __block CFTimeInterval emptyMount = 0;
      dispatch_sync(dispatch_get_main_queue(), ^{ probe.hidden = YES; SparkTestDriverDidMount(); emptyMount = CACurrentMediaTime(); });
      usleep(200000);
      NSDictionary *empty = Request(fd, @{ @"command": @"startup", @"timeoutMs": @0 });
      Check([Code(empty) isEqual:@"E_TIMEOUT"], [NSString stringWithFormat:@"startup waits for an element: %@", empty]);
      dispatch_sync(dispatch_get_main_queue(), ^{ probe.hidden = NO; });
      // Then the first UI mounts in three transactions 20 ms apart. A loaded machine may space them by more than the 100 ms
      // that ends startup, so the end is one of them; later mounts never move it.
      NSMutableArray<NSNumber *> *mounts = [NSMutableArray new];
      for (int index = 0; index < 3; index++) {
        if (index) usleep(20000);
        dispatch_sync(dispatch_get_main_queue(), ^{ SparkTestDriverDidMount(); [mounts addObject:@(CACurrentMediaTime())]; });
      }
      NSDictionary *startup = Request(fd, @{ @"command": @"startup" });
      NSDictionary *phases = startup[@"phases"];
      Check([startup[@"ok"] boolValue] && phases.count == 5, [NSString stringWithFormat:@"startup reports every phase: %@", startup]);
      double launching = [phases[@"willFinishLaunching"] doubleValue], launched = [phases[@"didFinishLaunching"] doubleValue], bundle = [phases[@"bundleLoaded"] doubleValue],
        mounted = [phases[@"firstMount"] doubleValue], settled = [phases[@"settled"] doubleValue];
      Check(launching > 0 && launching < 60000, [NSString stringWithFormat:@"phases count from the kernel's process start: %@", phases]);
      Check(launching <= launched && launched <= bundle && bundle <= mounted && mounted + 200 <= settled, [NSString stringWithFormat:@"phases are in launch order: %@", phases]);
      // firstMount is the empty UI's mount, 200 ms or more before the ones that show the element.
      BOOL atMount = NO;
      for (NSNumber *mount in mounts) atMount = atMount || fabs((settled - mounted) - (mount.doubleValue - emptyMount) * 1000) < 1;
      Check(atMount, [NSString stringWithFormat:@"the end of startup is a mount of the first UI: %@ (mounts %@)", phases, mounts]);
      // An element that shows at a later quiet point is ready then; one that never shows times out.
      NSDictionary *probeReady = Request(fd, @{ @"command": @"startup", @"testID": @"probe-layer" });
      Check([probeReady[@"phases"][@"ready"] isEqual:phases[@"settled"]], [NSString stringWithFormat:@"ready for an element of the first settled UI: %@", probeReady]);
      __block CFTimeInterval lateMount = 0;
      dispatch_sync(dispatch_get_main_queue(), ^{
        NSView *late = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)]; late.accessibilityIdentifier = @"late-element";
        [window.contentView addSubview:late];
        SparkTestDriverDidMount(); lateMount = CACurrentMediaTime();
      });
      NSDictionary *lateReady = Request(fd, @{ @"command": @"startup", @"testID": @"late-element" });
      Check(fabs([lateReady[@"phases"][@"ready"] doubleValue] - mounted - (lateMount - emptyMount) * 1000) < 1, [NSString stringWithFormat:@"ready when the element first showed: %@", lateReady]);
      NSDictionary *never = Request(fd, @{ @"command": @"startup", @"testID": @"never", @"timeoutMs": @0 });
      Check([Code(never) isEqual:@"E_TIMEOUT"] && [never[@"error"][@"message"] hasPrefix:@"never was not shown"], [NSString stringWithFormat:@"startup times out for an element that never shows: %@", never]);
      dispatch_sync(dispatch_get_main_queue(), ^{ SparkTestDriverDidMount(); });
      Check([Request(fd, @{ @"command": @"startup" })[@"phases"] isEqual:phases], @"later mounts do not change startup");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"commits"]) {
    // Views the client changes in separate run-loop turns (each turn commits once); `row` and `badge` are elements.
    NSView *content = window.contentView, *row = [[NSView alloc] initWithFrame:NSMakeRect(10, 10, 100, 20)], *badge = [[NSView alloc] initWithFrame:NSMakeRect(120, 10, 20, 20)];
    row.accessibilityIdentifier = @"row"; badge.accessibilityIdentifier = @"badge";
    [content addSubview:row]; [content addSubview:badge];
    NSView *probe = SparkTestDriverFindView(@"probe-layer");
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      auto turn = ^(dispatch_block_t change) { dispatch_async(dispatch_get_main_queue(), change); usleep(50000); };
      auto ok = ^(NSDictionary *request) {
        NSDictionary *reply = Request(fd, request);
        Check([reply[@"ok"] boolValue], [NSString stringWithFormat:@"%@: %@", request, reply]);
        return reply;
      };
      Check([Code(Request(fd, @{ @"command": @"stopCommits" })) isEqual:@"E_INVALID_STATE"], @"stopCommits needs startCommits");
      // One change per view, as one input causes: nothing to report.
      ok(@{ @"command": @"startCommits" });
      Check([Code(Request(fd, @{ @"command": @"startCommits" })) isEqual:@"E_BUSY"], @"one watch at a time");
      turn(^{ row.frame = NSMakeRect(10, 10, 120, 20); badge.frame = NSMakeRect(140, 10, 20, 20); });
      NSDictionary *clean = ok(@{ @"command": @"stopCommits" });
      Check([clean[@"commits"] intValue] == 1 && ![clean[@"relayouts"] count] && ![clean[@"gaps"] count] && ![clean[@"blanks"] count], [NSString stringWithFormat:@"a single relayout is not thrash: %@", clean]);
      // A view laid out in two commits, an element missing for one commit, and a view mounted then laid out once.
      ok(@{ @"command": @"startCommits" });
      __block NSView *late = nil;
      turn(^{ probe.frame = NSMakeRect(0, 200, 110, 100); badge.hidden = YES; late = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 5, 5)]; [content addSubview:late]; });
      turn(^{ probe.frame = NSMakeRect(0, 200, 100, 100); badge.hidden = NO; late.frame = NSMakeRect(0, 0, 6, 6); });
      NSDictionary *busy = ok(@{ @"command": @"stopCommits" });
      NSArray *relayouts = busy[@"relayouts"];
      Check(relayouts.count == 1 && [relayouts[0][@"view"] isEqual:@"probe-layer"] && [relayouts[0][@"changes"] isEqual:@2] && [relayouts[0][@"window"] isEqual:@"spark.main"]
        && [relayouts[0][@"frames"] count] == 3 && [relayouts[0][@"frames"][1][@"width"] isEqual:@110], [NSString stringWithFormat:@"a view laid out in two commits is thrash: %@", busy]);
      Check([busy[@"gaps"] isEqual:(@[@{ @"id": @"badge", @"window": @"spark.main", @"commits": @1 }])] && ![busy[@"blanks"] count], [NSString stringWithFormat:@"an element missing for one commit is a gap: %@", busy]);
      // A window showing none of its elements for a commit is blank; an element that leaves for good is no gap.
      ok(@{ @"command": @"startCommits" });
      turn(^{ content.hidden = YES; });
      turn(^{ content.hidden = NO; [row removeFromSuperview]; });
      NSDictionary *blank = ok(@{ @"command": @"stopCommits" });
      NSSet *gapped = [NSSet setWithArray:[blank[@"gaps"] valueForKey:@"id"]];
      Check([blank[@"blanks"] isEqual:(@[@{ @"window": @"spark.main", @"commits": @1 }])] && [gapped isEqual:([NSSet setWithArray:@[@"probe-layer", @"badge"]])], [NSString stringWithFormat:@"a blank commit: %@", blank]);
      // Watching ends when the UI never settles.
      ok(@{ @"command": @"startCommits" });
      mounting = true;
      dispatch_sync(dispatch_get_main_queue(), ^{
        SparkTestDriverDidMount();
        [NSTimer scheduledTimerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) { if (mounting) SparkTestDriverDidMount(); else [timer invalidate]; }];
      });
      Check([Code(Request(fd, @{ @"command": @"stopCommits", @"timeoutMs": @200 })) isEqual:@"E_NOT_SETTLED"], @"stopCommits waits for the UI to settle");
      mounting = false;
      ok(@{ @"command": @"startCommits" });
      ok(@{ @"command": @"stopCommits" });
      // Leak counters follow windows, views and file descriptors.
      NSDictionary *before = ok(@{ @"command": @"counters" });
      Check([before[@"windows"] intValue] >= 1 && [before[@"views"] intValue] >= 8 && [before[@"fileDescriptors"] intValue] >= 3, [NSString stringWithFormat:@"counters: %@", before]);
      __block NSWindow *extra = nil;
      int file = open("/dev/null", O_RDONLY);
      dispatch_sync(dispatch_get_main_queue(), ^{
        extra = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 50, 50) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
        extra.releasedWhenClosed = NO;
        [extra.contentView addSubview:[[NSView alloc] initWithFrame:NSMakeRect(0, 0, 5, 5)]];
      });
      NSDictionary *more = ok(@{ @"command": @"counters" });
      Check([more[@"windows"] intValue] == [before[@"windows"] intValue] + 1 && [more[@"views"] intValue] > [before[@"views"] intValue] + 1
        && [more[@"fileDescriptors"] intValue] == [before[@"fileDescriptors"] intValue] + 1, [NSString stringWithFormat:@"counters grow: %@ then %@", before, more]);
      close(file);
      dispatch_sync(dispatch_get_main_queue(), ^{ @autoreleasepool { [extra close]; extra = nil; } });
      NSDictionary *after = ok(@{ @"command": @"counters" });
      NSArray *keys = @[@"windows", @"views", @"fileDescriptors"];
      Check([[after dictionaryWithValuesForKeys:keys] isEqual:[before dictionaryWithValuesForKeys:keys]], [NSString stringWithFormat:@"counters return to the baseline: %@ then %@", before, after]);
      NSDictionary *memory = ok(@{ @"command": @"memory" });
      Check([memory[@"footprintMB"] doubleValue] > 1 && [memory[@"residentMB"] doubleValue] > 1, [NSString stringWithFormat:@"memory: %@", memory]);
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"state"]) {
    // The app's JavaScript, as exposeTestState answers: a value, an error, or (for "silent") nothing.
    __block NSDictionary *late = nil;
    [NSNotificationCenter.defaultCenter addObserverForName:SparkDesktopEvent object:nil queue:nil usingBlock:^(NSNotification *note) {
      NSDictionary *event = note.userInfo;
      if ([event[@"type"] isEqual:@"driverListeners"]) { dispatch_async(dispatch_get_main_queue(), ^{ SparkReplyDriverState(@{ @"requestId": event[@"requestId"], @"value": @7 }); }); return; }
      if (![event[@"type"] isEqual:@"driverState"]) return;
      Check(NSThread.isMainThread, @"state requests are emitted on the main thread");
      NSString *path = event[@"path"];
      dispatch_async(dispatch_get_main_queue(), ^{
        if ([path isEqual:@"silent"]) { late = @{ @"requestId": event[@"requestId"], @"value": @1 }; return; }
        BOOL known = [path isEqual:@"store.items"];
        Check(SparkReplyDriverState(known ? @{ @"requestId": event[@"requestId"], @"value": @[@1, @{ @"done": @YES }] }
          : @{ @"requestId": event[@"requestId"], @"error": @{ @"code": @"E_NOT_FOUND", @"message": [NSString stringWithFormat:@"No state named %@", path] } }), @"a waiting request takes the answer");
      });
    }];
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      NSDictionary *value = Request(fd, @{ @"command": @"state", @"path": @"store.items" });
      Check([value[@"ok"] boolValue] && [value[@"value"] isEqual:(@[@1, @{ @"done": @YES }])], [NSString stringWithFormat:@"state relays the value: %@", value]);
      NSDictionary *missing = Request(fd, @{ @"command": @"state", @"path": @"nope" });
      Check([Code(missing) isEqual:@"E_NOT_FOUND"] && [missing[@"error"][@"message"] isEqual:@"No state named nope"], [NSString stringWithFormat:@"state relays the app's error: %@", missing]);
      Check([Code(Request(fd, @{ @"command": @"state", @"path": @"" })) isEqual:@"E_INVALID_ARGUMENT"], @"state needs a path");
      Check([Code(Request(fd, @{ @"command": @"state", @"path": @"silent", @"timeoutMs": @200 })) isEqual:@"E_TIMEOUT"], @"state times out when the JavaScript never answers");
      Check(late && ![OnMain(^{ return @(SparkReplyDriverState(late)); }) boolValue], @"an answer after the timeout is dropped");
      Check(![OnMain(^{ return @(SparkReplyDriverState(@{ @"requestId": @999, @"value": @1 })); }) boolValue], @"an answer nobody asked for is dropped");
      // listeners: none while no JavaScript observes desktop events, else what it answers.
      NSDictionary *none = Request(fd, @{ @"command": @"listeners" });
      Check([none[@"ok"] boolValue] && [none[@"listeners"] isEqual:@0], [NSString stringWithFormat:@"listeners without observers: %@", none]);
      dispatch_sync(dispatch_get_main_queue(), ^{ SparkSetDesktopObserved(YES); });
      NSDictionary *some = Request(fd, @{ @"command": @"listeners" });
      Check([some[@"ok"] boolValue] && [some[@"listeners"] isEqual:@7], [NSString stringWithFormat:@"listeners the JavaScript reports: %@", some]);
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else if ([mode isEqual:@"audit"]) {
    // Accessibility audit facts: an image-only button without a description, faint text, a disabled React Native view,
    // and text below the fold of a scroll view, which the audit scrolls into view to render and then scrolls back.
    NSImage *glyph = [NSImage imageWithSize:NSMakeSize(16, 16) flipped:NO drawingHandler:^BOOL(NSRect rect) { [NSColor.blackColor setFill]; NSRectFill(rect); return YES; }];
    NSButton *unnamed = [NSButton buttonWithImage:glyph target:nil action:nil];
    unnamed.frame = NSMakeRect(20, 40, 32, 32); unnamed.accessibilityIdentifier = @"audit-unnamed";
    NSTextField *faint = [NSTextField labelWithString:@"Faint"];
    faint.frame = NSMakeRect(60, 40, 120, 20); faint.font = [NSFont systemFontOfSize:13]; faint.accessibilityIdentifier = @"audit-faint";
    faint.textColor = [NSColor colorWithSRGBRed:0.8 green:0.8 blue:0.8 alpha:1];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(200, 10, 180, 60)];
    NSView *document = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 180, 300)];
    NSTextField *below = [NSTextField labelWithString:@"Below the fold"];
    below.frame = NSMakeRect(10, 260, 160, 20); below.accessibilityIdentifier = @"audit-below";
    [document addSubview:below];
    scroll.documentView = document;
    // A view exposed as a button that does not accept first responder, as a React Native Pressable without `focusable`.
    NSView *pressable = [[NSView alloc] initWithFrame:NSMakeRect(20, 80, 40, 20)];
    pressable.accessibilityElement = YES; pressable.accessibilityRole = NSAccessibilityButtonRole; pressable.accessibilityLabel = @"Pressable";
    pressable.accessibilityIdentifier = @"audit-pressable";
    // A disabled, selected React Native Pressable (which `disabled` makes refuse focus) around faint text; an AppKit
    // text view, which reports isAccessibilityEnabled NO, is not disabled by it.
    RCTViewComponentView *disabled = [[RCTViewComponentView alloc] initWithFrame:NSMakeRect(80, 80, 60, 20)];
    disabled.accessibilityElement = YES; disabled.accessibilityRole = NSAccessibilityButtonRole; disabled.accessibilityLabel = @"Disabled";
    disabled.accessibilityIdentifier = @"audit-disabled"; disabled.disabled = YES; disabled.chosen = YES;
    NSTextField *dimmed = [NSTextField labelWithString:@"Dim"];
    dimmed.frame = NSMakeRect(0, 0, 60, 20); dimmed.accessibilityIdentifier = @"audit-disabled-text";
    dimmed.textColor = [NSColor colorWithSRGBRed:0.9 green:0.9 blue:0.9 alpha:1];
    [disabled addSubview:dimmed];
    NSTextView *textView = [[NSTextView alloc] initWithFrame:NSMakeRect(150, 80, 40, 20)];
    textView.accessibilityIdentifier = @"audit-text-view";
    for (NSView *view in @[unnamed, faint, scroll, pressable, disabled, textView]) [window.contentView addSubview:view];
    const NSPoint origin = scroll.contentView.bounds.origin;
    Client(^{
      int fd = Connect();
      SendRaw(fd, [NSString stringWithFormat:@"{\"token\":\"%s\"}\n", token]);
      Check([Receive(fd)[@"ok"] boolValue], @"authenticated");
      Check([Code(Request(fd, @{ @"command": @"accessibilityAudit", @"scope": @"screen", @"name": @"a" })) isEqual:@"E_INVALID_ARGUMENT"], @"audit scope is window or app");
      Check([Code(Request(fd, @{ @"command": @"accessibilityAudit", @"name": @"../a" })) isEqual:@"E_INVALID_ARGUMENT"], @"audit names stay in the run directory");
      NSDictionary *audit = Request(fd, @{ @"command": @"accessibilityAudit", @"name": @"audit" });
      Check([audit[@"ok"] boolValue] && [audit[@"windows"][0][@"id"] isEqual:@"spark.main"], [NSString stringWithFormat:@"accessibilityAudit %@", audit]);
      NSDictionary *(^byID)(NSString *) = ^NSDictionary *(NSString *testID) {
        for (NSDictionary *element in audit[@"elements"]) if ([element[@"id"] isEqual:testID]) return element;
        return nil;
      };
      NSDictionary *button = byID(@"audit-unnamed");
      Check([button[@"role"] isEqual:@"button"] && !button[@"label"] && !button[@"title"] && [button[@"element"] boolValue] && [button[@"enabled"] boolValue],
        [NSString stringWithFormat:@"an image-only button has no label or title (%@)", button]);
      Check([button[@"focusable"] boolValue] && ![byID(@"audit-pressable")[@"focusable"] boolValue],
        [NSString stringWithFormat:@"an AppKit button takes focus; a view that does not accept first responder does not (%@)", byID(@"audit-pressable")]);
      Check(![byID(@"audit-disabled")[@"enabled"] boolValue] && ![byID(@"audit-disabled-text")[@"enabled"] boolValue] && [byID(@"audit-text-view")[@"enabled"] boolValue]
        && [byID(@"audit-pressable")[@"enabled"] boolValue],
        [NSString stringWithFormat:@"a disabled React Native view and its text are not enabled; an AppKit text view is (%@, %@)", byID(@"audit-disabled"), byID(@"audit-text-view")]);
      NSDictionary *reported = nil;
      for (NSDictionary *element in Request(fd, @{ @"command": @"elements" })[@"elements"]) if ([element[@"id"] isEqual:@"audit-disabled"]) reported = element;
      Check([reported[@"enabled"] isEqual:@NO] && [reported[@"selected"] isEqual:@YES], [NSString stringWithFormat:@"elements: a view's accessibility enabled and selected state (%@)", reported]);
      NSDictionary *native = nil;
      for (NSDictionary *element in audit[@"elements"]) if ([element[@"role"] isEqual:@"button"] && [element[@"title"] isEqual:@"Native button"]) native = element;
      Check(native != nil, @"a titled button reports its title");
      NSDictionary *text = byID(@"audit-faint");
      Check([text[@"text"] isEqual:@"Faint"] && [text[@"textStyle"][@"colors"] isEqual:@[@{ @"r": @204, @"g": @204, @"b": @204, @"a": @1 }]] && [text[@"textStyle"][@"size"] isEqual:@13]
        && ![text[@"textStyle"][@"bold"] boolValue] && [text[@"capture"] isEqual:@0] && ![text[@"clipped"] boolValue],
        [NSString stringWithFormat:@"text reports its declared colour, size and where the first render shows it (%@)", text]);
      NSDictionary *sample = text[@"sample"], *capture = audit[@"captures"][0];
      CGFloat scale = [capture[@"scale"] doubleValue];
      Check(scale >= 1 && [sample[@"width"] doubleValue] == floor(180 * scale) - ceil(60 * scale) && [sample[@"height"] doubleValue] == floor(20 * scale) - ceil(0 * scale),
        [NSString stringWithFormat:@"the sample is the text's pixels in the capture (%@ at %@)", sample, capture]);
      NSDictionary *hidden = byID(@"audit-below");
      Check([hidden[@"capture"] intValue] >= 1 && ![hidden[@"clipped"] boolValue] && [audit[@"captures"] count] == [hidden[@"capture"] unsignedIntegerValue] + 1,
        [NSString stringWithFormat:@"text below the fold is scrolled into view and rendered again (%@, %@)", hidden, audit[@"captures"]]);
      for (NSDictionary *each in audit[@"captures"]) {
        struct stat file;
        Check(stat([directory stringByAppendingPathComponent:each[@"file"]].fileSystemRepresentation, &file) == 0 && (file.st_mode & 0777) == 0600, @"audit captures are private files in the run directory");
      }
      NSValue *restored = OnMain(^{ return [NSValue valueWithPoint:scroll.contentView.bounds.origin]; });
      Check(NSEqualPoints(restored.pointValue, origin), @"the audit restores scroll positions");
      Check([Request(fd, @{ @"command": @"quit" })[@"ok"] boolValue], @"quit");
      finished = YES;
    });
  }
  else Check(NO, [@"unknown mode " stringByAppendingString:mode]);

  Pump(^{ return (BOOL)(finished && terminateRequested); }, 20);
  Check(finished, @"client finished");
  Check(terminateRequested, @"the app quits when the session ends");
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
    // A selected source-list row in a window that is not key: the window server tints its selection material,
    // which in-process drawing renders black; the capture draws the unemphasized selection color instead.
    NSRect selected = [selectionTable convertRect:[selectionTable rectOfRow:0] toView:window.contentView];
    NSColor *selection = Sample(@"cache.png", NSMakeRect(NSMaxX(selected) - 60, NSMinY(selected), 20, NSHeight(selected)), window);
    __block NSColor *unemphasized;
    [[NSAppearance appearanceNamed:NSAppearanceNameAqua] performAsCurrentDrawingAppearance:^{
      unemphasized = [NSColor.unemphasizedSelectedContentBackgroundColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    }];
    Check(Near(selection, unemphasized.redComponent, unemphasized.greenComponent, unemphasized.blueComponent),
      [NSString stringWithFormat:@"a selected source-list row captures in the unemphasized selection color %@, not %@", Describe(unemphasized), Describe(selection)]);
    NSRect unselected = [selectionTable convertRect:[selectionTable rectOfRow:1] toView:window.contentView];
    Check(Near(Sample(@"cache.png", NSMakeRect(NSMaxX(unselected) - 60, NSMinY(unselected), 20, NSHeight(unselected)), window), 1, 1, 1), @"an unselected row stays clear");
    // The capture leaves the selection as it was: its filtered layer visible again and no cover left behind.
    NSMutableArray<CALayer *> *filtered = [NSMutableArray new], *covers = [NSMutableArray new];
    __block void (^walk)(CALayer *);
    void (^visit)(CALayer *) = ^(CALayer *layer) {
      if (layer.compositingFilter) [filtered addObject:layer];
      NSColor *background = layer.backgroundColor ? [[NSColor colorWithCGColor:layer.backgroundColor] colorUsingColorSpace:NSColorSpace.sRGBColorSpace] : nil;
      if (background.alphaComponent > 0.5 && Near(background, unemphasized.redComponent, unemphasized.greenComponent, unemphasized.blueComponent)) [covers addObject:layer];
      for (CALayer *sublayer in layer.sublayers) walk(sublayer);
    };
    walk = visit;
    walk([selectionTable rowViewAtRow:0 makeIfNecessary:NO].layer);
    Check(filtered.count == 1 && !filtered.firstObject.hidden && covers.count == 0, @"the selection material is restored after the capture");
  }
  if ([mode isEqual:@"hooks"]) Check(Near(Sample(@"wrapped.png", NSMakeRect(0, 200, 100, 100), window), 0, 0, 1), @"capture renders inside the render wrappers");
  [NSFileManager.defaultManager removeItemAtPath:directory error:nil];
  printf("%s passed\n", mode.UTF8String);
  return 0;
} }
