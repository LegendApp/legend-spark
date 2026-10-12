#import "SparkDisplays.h"
#import "SparkWindowGeometry.h"

static NSArray<NSDictionary *> *Simulated;
static NSNotificationName const SimulationChanged = @"SparkDisplaysSimulationChanged";
static double Rounded(double value) { return round(value * 100) / 100; }

static NSDictionary *Details(NSScreen *screen, NSRect primary) {
  NSMutableDictionary *details = [SparkDisplayInfoForScreen(screen) mutableCopy];
  NSRect frame = screen.frame;
  details[@"origin"] = @{ @"x": @(NSMinX(frame) - NSMinX(primary)), @"y": @(NSMaxY(primary) - NSMaxY(frame)) };
  NSEdgeInsets safe = screen.safeAreaInsets;
  details[@"safeArea"] = @{ @"top": @(safe.top), @"left": @(safe.left), @"bottom": @(safe.bottom), @"right": @(safe.right) };
  // ProMotion and adaptive-sync displays vary between the two intervals; fixed-rate displays report one.
  // A non-positive interval has no rate: null, which JavaScript rejects as E_INVALID_DATA (an infinite
  // number would make NSJSONSerialization raise).
  NSTimeInterval shortest = screen.minimumRefreshInterval, longest = screen.maximumRefreshInterval;
  if (shortest > 0 && longest > 0) {
    double maximum = Rounded(1 / shortest), minimum = Rounded(1 / longest);
    details[@"refreshRate"] = @{ @"maximum": @(maximum), @"minimum": @(minimum), @"variable": @(minimum < maximum) };
  } else details[@"refreshRate"] = NSNull.null;
  NSColorSpace *space = screen.colorSpace;
  NSString *name = space.localizedName ?: CFBridgingRelease(CGColorSpaceCopyName(space.CGColorSpace));
  details[@"colorSpace"] = @{ @"name": name ?: (id)NSNull.null, @"gamut": [screen canRepresentDisplayGamut:NSDisplayGamutP3] ? @"p3" : @"srgb" };
  CGFloat reference = screen.maximumReferenceExtendedDynamicRangeColorComponentValue;
  details[@"edrHeadroom"] = @{ @"current": @(Rounded(screen.maximumExtendedDynamicRangeColorComponentValue)),
    @"potential": @(Rounded(screen.maximumPotentialExtendedDynamicRangeColorComponentValue)), @"reference": reference > 0 ? @(Rounded(reference)) : NSNull.null };
  return details;
}

NSArray<NSDictionary *> *SparkDisplayDetails(void) {
  if (Simulated) return Simulated;
  NSRect primary = SparkPrimaryScreen().frame;
  NSMutableArray *result = [NSMutableArray new];
  for (NSScreen *screen in NSScreen.screens) [result addObject:Details(screen, primary)];
  return result;
}

void SparkSimulateDisplays(NSArray<NSDictionary *> *displays) {
  Simulated = [displays copy];
  [NSNotificationCenter.defaultCenter postNotificationName:SimulationChanged object:nil];
}
BOOL SparkDisplaysSimulated(void) { return Simulated != nil; }

static BOOL Numbers(id value, NSArray<NSString *> *keys) {
  if (![value isKindOfClass:NSDictionary.class]) return NO;
  for (NSString *key in keys) if (![value[key] isKindOfClass:NSNumber.class] || !isfinite([value[key] doubleValue])) return NO;
  return YES;
}
BOOL SparkValidSimulatedDisplays(id displays) {
  if (![displays isKindOfClass:NSArray.class] || ![displays count] || ![NSJSONSerialization isValidJSONObject:displays]) return NO;
  NSMutableSet *ids = [NSMutableSet new]; NSUInteger primaries = 0;
  for (NSDictionary *display in displays) {
    if (![display isKindOfClass:NSDictionary.class] || ![display[@"id"] isKindOfClass:NSString.class] || ![display[@"id"] length] || [ids containsObject:display[@"id"]]) return NO;
    if (![display[@"primary"] isKindOfClass:NSNumber.class] || !Numbers(display[@"origin"], @[@"x", @"y"]) || !Numbers(display[@"size"], @[@"width", @"height"])
      || !Numbers(display[@"workArea"], @[@"x", @"y", @"width", @"height"]) || ![display[@"scaleFactor"] isKindOfClass:NSNumber.class]) return NO;
    if ([display[@"size"][@"width"] doubleValue] <= 0 || [display[@"size"][@"height"] doubleValue] <= 0 || [display[@"scaleFactor"] doubleValue] <= 0) return NO;
    [ids addObject:display[@"id"]]; primaries += [display[@"primary"] boolValue];
  }
  return primaries == 1;
}

@interface SparkScreen ()
@property (readwrite) NSString *identifier;
@property (readwrite, nullable) NSString *persistentId;
@property (readwrite) NSString *name;
@property (readwrite) BOOL primary;
@property (readwrite) NSRect frame;
@property (readwrite) NSRect visibleFrame;
@property (readwrite) CGFloat scaleFactor;
@property (readwrite, nullable) NSScreen *screen;
@end
@implementation SparkScreen @end

NSArray<SparkScreen *> *SparkScreens(void) {
  NSMutableArray *result = [NSMutableArray new];
  if (Simulated) {
    // Origins are top-left, Y downward, from the primary display's top-left; AppKit's global Y is upward from
    // the primary display's bottom-left.
    CGFloat primaryHeight = 0;
    for (NSDictionary *display in Simulated) if ([display[@"primary"] boolValue]) primaryHeight = [display[@"size"][@"height"] doubleValue];
    for (NSDictionary *display in Simulated) {
      SparkScreen *screen = [SparkScreen new];
      NSDictionary *origin = display[@"origin"], *size = display[@"size"], *area = display[@"workArea"];
      CGFloat height = [size[@"height"] doubleValue];
      screen.frame = NSMakeRect([origin[@"x"] doubleValue], primaryHeight - [origin[@"y"] doubleValue] - height, [size[@"width"] doubleValue], height);
      screen.visibleFrame = NSMakeRect(NSMinX(screen.frame) + [area[@"x"] doubleValue], NSMaxY(screen.frame) - [area[@"y"] doubleValue] - [area[@"height"] doubleValue], [area[@"width"] doubleValue], [area[@"height"] doubleValue]);
      screen.identifier = display[@"id"]; screen.primary = [display[@"primary"] boolValue]; screen.scaleFactor = [display[@"scaleFactor"] doubleValue];
      screen.persistentId = [display[@"persistentId"] isKindOfClass:NSString.class] ? display[@"persistentId"] : nil;
      screen.name = [display[@"name"] isKindOfClass:NSString.class] ? display[@"name"] : @"";
      [result addObject:screen];
    }
    return result;
  }
  NSScreen *primary = SparkPrimaryScreen();
  for (NSScreen *real in NSScreen.screens) {
    SparkScreen *screen = [SparkScreen new];
    screen.screen = real; screen.frame = real.frame; screen.visibleFrame = real.visibleFrame; screen.identifier = SparkScreenId(real) ?: @"";
    screen.persistentId = SparkPersistentScreenId(real); screen.name = real.localizedName ?: @""; screen.primary = real == primary; screen.scaleFactor = real.backingScaleFactor;
    [result addObject:screen];
  }
  return result;
}
SparkScreen *SparkScreenForId(NSString *identifier) {
  for (SparkScreen *screen in SparkScreens()) if ([screen.identifier isEqual:identifier]) return screen;
  return nil;
}
SparkScreen *SparkPrimary(void) {
  NSArray<SparkScreen *> *screens = SparkScreens();
  for (SparkScreen *screen in screens) if (screen.primary) return screen;
  return screens.firstObject;
}
SparkScreen *SparkOwning(NSRect frame) {
  NSArray<SparkScreen *> *screens = SparkScreens();
  SparkScreen *best = nil; CGFloat area = -1;
  for (SparkScreen *screen in screens) {
    NSRect intersection = NSIntersectionRect(frame, screen.frame);
    CGFloat next = NSWidth(intersection) * NSHeight(intersection);
    if (next > area || (next == area && screen.primary)) { best = screen; area = next; }
  }
  return best ?: SparkPrimary();
}
NSDictionary *SparkWindowBounds(NSWindow *window) {
  SparkScreen *screen = SparkOwning(window.frame);
  return SparkLogicalBounds(window.frame, screen.frame, screen.identifier);
}
NSArray<NSDictionary *> *SparkWindowDisplays(void) {
  NSMutableArray *result = [NSMutableArray new];
  for (SparkScreen *screen in SparkScreens()) {
    NSMutableDictionary *workArea = [SparkLogicalBounds(screen.visibleFrame, screen.frame, screen.identifier) mutableCopy];
    [workArea removeObjectForKey:@"displayId"];
    [result addObject:@{ @"id": screen.identifier, @"persistentId": screen.persistentId ?: NSNull.null, @"name": screen.name, @"primary": @(screen.primary),
      @"size": @{ @"width": @(NSWidth(screen.frame)), @"height": @(NSHeight(screen.frame)) }, @"workArea": workArea, @"scaleFactor": @(screen.scaleFactor) }];
  }
  return result;
}
NSDictionary *SparkPointer(void) {
  NSPoint point = NSEvent.mouseLocation;
  SparkScreen *found = nil;
  for (SparkScreen *screen in SparkScreens()) if (NSPointInRect(point, screen.frame)) { found = screen; break; }
  if (!found) found = SparkPrimary();
  return @{ @"displayId": found.identifier, @"x": @(point.x - NSMinX(found.frame)), @"y": @(NSMaxY(found.frame) - point.y) };
}

@interface SparkDisplayObserver ()
- (void)notify;
@end
static void Reconfigured(CGDirectDisplayID, CGDisplayChangeSummaryFlags flags, void *observer) {
  if (flags & kCGDisplayBeginConfigurationFlag) return;
  // AppKit refreshes NSScreen on the main queue; read the details after it.
  // Callbacks arrive on the main thread while registered; stop unregisters before the observer goes.
  __weak SparkDisplayObserver *weak = (__bridge SparkDisplayObserver *)observer;
  dispatch_async(dispatch_get_main_queue(), ^{ [weak notify]; });
}

@interface SparkDisplayObserver ()
@property (copy) void (^changed)(void);
@property NSArray *tokens;
@end
@implementation SparkDisplayObserver
- (instancetype)initWithHandler:(void (^)(void))changed {
  if (!(self = [super init])) return nil;
  _changed = [changed copy];
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  __weak SparkDisplayObserver *weak = self;
  void (^notify)(NSNotification *) = ^(NSNotification *) { [weak notify]; };
  _tokens = @[[center addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:notify],
    [center addObserverForName:NSScreenColorSpaceDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:notify],
    [center addObserverForName:SimulationChanged object:nil queue:NSOperationQueue.mainQueue usingBlock:notify]];
  CGDisplayRegisterReconfigurationCallback(Reconfigured, (__bridge void *)self);
  return self;
}
- (void)notify { if (self.changed) self.changed(); }
- (void)stop {
  if (!self.tokens) return;
  CGDisplayRemoveReconfigurationCallback(Reconfigured, (__bridge void *)self);
  for (id token in self.tokens) [NSNotificationCenter.defaultCenter removeObserver:token];
  self.tokens = nil; self.changed = nil;
}
- (void)dealloc { [self stop]; }
@end
