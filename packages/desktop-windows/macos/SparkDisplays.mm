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
