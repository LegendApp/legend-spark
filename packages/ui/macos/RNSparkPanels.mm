#import "RNSparkPanels.h"
#import "SparkColor.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// CSS weights and the AppKit weight traits they name; reported weights snap to the nearest.
static const struct { int css; CGFloat trait; } SparkWeights[] = {
  { 100, -0.8 }, { 200, -0.6 }, { 300, -0.4 }, { 400, 0 }, { 500, 0.23 }, { 600, 0.3 }, { 700, 0.4 }, { 800, 0.56 }, { 900, 0.62 },
};
static NSDictionary *SparkFontJSON(NSFont *font) {
  CGFloat trait = [[font.fontDescriptor objectForKey:NSFontTraitsAttribute][NSFontWeightTrait] doubleValue];
  int weight = 400; CGFloat distance = INFINITY;
  for (auto entry : SparkWeights) if (fabs(entry.trait - trait) < distance) { distance = fabs(entry.trait - trait); weight = entry.css; }
  return @{ @"family": font.familyName ?: @"", @"postScriptName": font.fontName, @"size": @(font.pointSize), @"weight": @(weight),
            @"italic": @((font.fontDescriptor.symbolicTraits & NSFontDescriptorTraitItalic) != 0) };
}
// Nil when the family is not installed: Spark never substitutes another family.
static NSFont *SparkFontFromJSON(NSDictionary *args) {
  CGFloat trait = 0;
  for (auto entry : SparkWeights) if (entry.css == [args[@"weight"] intValue]) trait = entry.trait;
  NSFontDescriptor *wanted = [NSFontDescriptor fontDescriptorWithFontAttributes:@{
    NSFontFamilyAttribute: args[@"family"],
    NSFontTraitsAttribute: @{ NSFontWeightTrait: @(trait), NSFontSymbolicTrait: @([args[@"italic"] boolValue] ? NSFontDescriptorTraitItalic : 0) },
  }];
  NSFontDescriptor *match = [wanted matchingFontDescriptorWithMandatoryKeys:[NSSet setWithObject:NSFontFamilyAttribute]];
  NSFont *font = match ? [NSFont fontWithDescriptor:match size:[args[@"size"] doubleValue]] : nil;
  return [font.familyName isEqual:args[@"family"]] ? font : nil;
}
static NSDictionary<NSString *, NSNumber *> *SparkColorModes(void) {
  return @{ @"wheel": @(NSColorPanelModeWheel), @"rgb": @(NSColorPanelModeRGB), @"hsb": @(NSColorPanelModeHSB), @"cmyk": @(NSColorPanelModeCMYK),
            @"gray": @(NSColorPanelModeGray), @"palettes": @(NSColorPanelModeColorList), @"image": @(NSColorPanelModeCustomPalette), @"pencils": @(NSColorPanelModeCrayon) };
}

// The color and font panels are app-wide singletons: one session owns each at a time.
// A newer session, a ColorWell taking the color panel, or the user closing a panel ends it.
// Observers exist only while a session does, and a session's end removes them.
@interface RNSparkPanels () <NSFontChanging>
@property NSString *colorSession, *fontSession;
@property BOOL colorAlpha, colorWasContinuous;
@property NSFont *font;
@property NSColorSampler *sampler;
@end
@implementation RNSparkPanels
RCT_EXPORT_MODULE(NativeSparkPanels)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (void)endColorSession:(NSString *)reason {
  if (!self.colorSession) return;
  NSString *session = self.colorSession; self.colorSession = nil;
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSWindowWillCloseNotification object:NSColorPanel.sharedColorPanel];
  [NSNotificationCenter.defaultCenter removeObserver:self name:SparkColorPanelOwnerWillChange object:nil];
  // NSColorPanel has no target getter. A well taking over announces itself before it activates,
  // so clearing here never strips another owner's target.
  NSColorPanel.sharedColorPanel.target = nil; NSColorPanel.sharedColorPanel.action = NULL;
  NSColorPanel.sharedColorPanel.continuous = self.colorWasContinuous;
  if (reason) SparkEmit(@{ @"type": @"colorPanelClose", @"sessionId": session, @"reason": reason });
}
- (void)endFontSession:(NSString *)reason {
  if (!self.fontSession) return;
  NSString *session = self.fontSession; self.fontSession = nil; self.font = nil;
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSWindowWillCloseNotification object:[NSFontManager.sharedFontManager fontPanel:NO]];
  if (NSFontManager.sharedFontManager.target == self) NSFontManager.sharedFontManager.target = nil;
  if (reason) SparkEmit(@{ @"type": @"fontPanelClose", @"sessionId": session, @"reason": reason });
}
// Ends this module's session without an event and takes its panel off screen; a panel another owner holds stays.
- (void)closeColorSession { if (self.colorSession) { [self endColorSession:nil]; [NSColorPanel.sharedColorPanel orderOut:nil]; } }
- (void)closeFontSession { if (self.fontSession) { [self endFontSession:nil]; [[NSFontManager.sharedFontManager fontPanel:NO] orderOut:nil]; } }
- (void)colorPanelWillClose:(NSNotification *)notification { [self endColorSession:@"dismissed"]; }
- (void)fontPanelWillClose:(NSNotification *)notification { [self endFontSession:@"dismissed"]; }
- (void)colorOwnerWillChange:(NSNotification *)notification { if (notification.object != self) [self endColorSession:@"replaced"]; }
- (void)colorChanged:(NSColorPanel *)panel {
  if (!self.colorSession) return;
  // A color without an sRGB form reaches JS as null, which reports E_INVALID_DATA.
  SparkEmit(@{ @"type": @"colorPanelChange", @"sessionId": self.colorSession, @"color": SparkHexFromColor(panel.color, self.colorAlpha) ?: NSNull.null });
}
- (void)changeFont:(NSFontManager *)manager {
  if (!self.fontSession) return;
  self.font = [manager convertFont:self.font];
  SparkEmit(@{ @"type": @"fontPanelChange", @"sessionId": self.fontSession, @"font": SparkFontJSON(self.font) });
}
// Driver-mode apps never put windows on screen (docs/test-driver.md), and the sampler would take
// over the real pointer, so each refuses there rather than reaching the person using the Mac.
static BOOL SparkRefuseInDriver(RCTPromiseRejectBlock reject, NSString *what) {
  if (!SparkTestDriverActive()) return NO;
  reject(@"E_UNAVAILABLE", [NSString stringWithFormat:@"%@ needs the screen; test driver mode never shows windows", what], nil);
  return YES;
}
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSDictionary *args = SparkArgs(json);
  NSString *session = args[@"sessionId"];
  if ([method isEqual:@"colorPanel.show"]) {
    NSNumber *mode = [args[@"mode"] length] ? SparkColorModes()[args[@"mode"]] : nil;
    if ([args[@"mode"] length] && !mode) { SparkInvalid(reject, @"Unknown color panel mode"); return; }
    if (SparkRefuseInDriver(reject, @"The color panel")) return;
    [self endColorSession:@"replaced"];
    [NSNotificationCenter.defaultCenter postNotificationName:SparkColorPanelOwnerWillChange object:self];
    NSColorPanel *panel = NSColorPanel.sharedColorPanel;
    // Configure before taking the target, so setup never reports a change.
    self.colorWasContinuous = panel.continuous;
    panel.showsAlpha = [args[@"alpha"] boolValue]; panel.continuous = YES;
    if (mode) panel.mode = (NSColorPanelMode)mode.integerValue;
    if ([args[@"color"] length]) panel.color = SparkColorFromHex(args[@"color"]);
    panel.target = self; panel.action = @selector(colorChanged:);
    self.colorSession = session; self.colorAlpha = [args[@"alpha"] boolValue];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(colorPanelWillClose:) name:NSWindowWillCloseNotification object:panel];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(colorOwnerWillChange:) name:SparkColorPanelOwnerWillChange object:nil];
    [panel orderFront:nil];
    resolve(@"null");
  } else if ([method isEqual:@"fontPanel.show"]) {
    NSFont *font = SparkFontFromJSON(args);
    if (!font) { reject(@"E_NOT_FOUND", [NSString stringWithFormat:@"Font family is not installed: %@", args[@"family"]], nil); return; }
    if (SparkRefuseInDriver(reject, @"The font panel")) return;
    [self endFontSession:@"replaced"];
    NSFontManager *manager = NSFontManager.sharedFontManager;
    [manager setSelectedFont:font isMultiple:NO];
    manager.target = self;
    self.fontSession = session; self.font = font;
    NSFontPanel *panel = [manager fontPanel:YES];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(fontPanelWillClose:) name:NSWindowWillCloseNotification object:panel];
    [panel orderFront:nil];
    resolve(SparkJSON(SparkFontJSON(font)));
  } else if ([method isEqual:@"colorPanel.close"] || [method isEqual:@"fontPanel.close"]) {
    BOOL color = [method isEqual:@"colorPanel.close"];
    // JS already stopped this session's callbacks; a session that has ended leaves the panel to its new owner.
    if (color && [session isEqual:self.colorSession]) [self closeColorSession];
    if (!color && [session isEqual:self.fontSession]) [self closeFontSession];
    resolve(@"null");
  } else if ([method isEqual:@"sampleScreenColor"]) {
    if (SparkRefuseInDriver(reject, @"The eyedropper")) return;
    // One pointer, one sampler: a second request while the user is sampling is refused.
    if (self.sampler) { reject(@"E_BUSY", @"The eyedropper is already sampling", nil); return; }
    // The sampler runs in AppKit's ColorSampler service, which holds the screen-capture
    // allowance; this process receives only the chosen color, so it needs no Screen Recording.
    self.sampler = [NSColorSampler new];
    __weak RNSparkPanels *weakSelf = self;
    [self.sampler showSamplerWithSelectionHandler:^(NSColor *color) {
      weakSelf.sampler = nil;
      NSString *hex = color ? SparkHexFromColor(color, NO) : nil;
      if (!color) resolve(SparkJSON(@{ @"canceled": @YES }));
      else if (hex) resolve(SparkJSON(@{ @"canceled": @NO, @"color": hex }));
      else reject(@"E_INVALID_DATA", @"The sampled color has no sRGB form", nil);
    }];
  } else SparkInvalid(reject, @"Unknown panel operation");
}
// A reload leaves nobody listening, so the panels this module owned leave the screen.
- (void)invalidate { [self closeColorSession]; [self closeFontSession]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeSparkPanelsSpecJSI>(params); }
@end
