#import <AppKit/AppKit.h>
#include <cassert>
// Stand-ins for React and RNDesktopApp: promise blocks, the desktop event emitter and JSON helpers.
typedef void (^RCTPromiseResolveBlock)(id result);
typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);
#define RCT_EXPORT_MODULE(name)
@protocol NativeSparkPanelsSpec @end
static NSMutableArray<NSDictionary *> *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event]; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static BOOL driverActive = NO;
static BOOL SparkTestDriverActive(void) { return driverActive; }
@interface RNSparkPanels : NSObject <NativeSparkPanelsSpec>
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
- (void)colorChanged:(NSColorPanel *)panel;
- (void)invalidate;
@end
// Panels are recorded, never put on screen; the sampler answers without taking over the pointer.
static int colorShown = 0, colorHidden = 0, fontShown = 0, fontHidden = 0;
@implementation NSColorPanel (Recording)
- (void)orderFront:(id)sender { colorShown++; }
- (void)orderOut:(id)sender { colorHidden++; }
@end
@implementation NSFontPanel (Recording)
- (void)orderFront:(id)sender { fontShown++; }
- (void)orderOut:(id)sender { fontHidden++; }
@end
// The sampler answers at once, or holds its handler (`holdSample`) like a user still sampling.
static NSColor *sampled; static int samplerUsed = 0; static BOOL holdSample = NO; static void (^heldSample)(NSColor *);
@implementation NSColorSampler (Recording)
- (void)showSamplerWithSelectionHandler:(void (^)(NSColor *))handler { samplerUsed++; if (holdSample) heldSample = handler; else handler(sampled); }
@end
// ACTUAL_IMPLEMENTATION
struct Result { NSString *value, *code, *message; };
static Result Call(RNSparkPanels *panels, NSString *method, NSDictionary *args) {
  __block Result result = {};
  [panels call:method args:SparkJSON(args) resolve:^(id value) { result.value = value; } reject:^(NSString *code, NSString *message, NSError *error) { result.code = code; result.message = message; }];
  return result;
}
static id JSON(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil]; }
int main() { @autoreleasepool {
  [NSApplication sharedApplication]; events = [NSMutableArray new];
  RNSparkPanels *panels = [RNSparkPanels new];
  // NSColorPanel has no public target getter; KVC reads it.
  NSColorPanel *panel = NSColorPanel.sharedColorPanel;

  // Color: configure, take the target, present; setup reports no change.
  Result shown = Call(panels, @"colorPanel.show", @{ @"sessionId": @"c1", @"color": @"#ff000080", @"alpha": @YES, @"mode": @"wheel" });
  assert([shown.value isEqual:@"null"] && !shown.code && colorShown == 1 && events.count == 0);
  assert(panel.showsAlpha && panel.mode == NSColorPanelModeWheel && panel.continuous && [panel valueForKey:@"target"] == panels && [SparkHexFromColor(panel.color, YES) isEqual:@"#ff000080"]);
  panel.color = [NSColor colorWithSRGBRed:0 green:1 blue:0 alpha:0.25]; [panels colorChanged:panel];
  assert(([events.lastObject isEqual:@{ @"type": @"colorPanelChange", @"sessionId": @"c1", @"color": @"#00ff0040" }]));
  // Omitted color and mode leave the panel's own.
  Call(panels, @"colorPanel.show", @{ @"sessionId": @"c2", @"color": @"", @"alpha": @NO, @"mode": @"" });
  assert(([events.lastObject isEqual:@{ @"type": @"colorPanelClose", @"sessionId": @"c1", @"reason": @"replaced" }]));
  assert(!panel.showsAlpha && panel.mode == NSColorPanelModeWheel && [SparkHexFromColor(panel.color, NO) isEqual:@"#00ff00"]);
  [panels colorChanged:panel]; assert([events.lastObject[@"color"] isEqual:@"#00ff00"]);
  assert([Call(panels, @"colorPanel.show", @{ @"sessionId": @"bad", @"color": @"", @"alpha": @NO, @"mode": @"crayons" }).code isEqual:@"E_INVALID_ARGUMENT"]);
  assert([panel valueForKey:@"target"] == panels);
  // A ColorWell taking the panel ends the session and releases the target.
  [NSNotificationCenter.defaultCenter postNotificationName:SparkColorPanelOwnerWillChange object:[NSObject new]];
  assert(([events.lastObject isEqual:@{ @"type": @"colorPanelClose", @"sessionId": @"c2", @"reason": @"replaced" }]) && [panel valueForKey:@"target"] == nil);
  NSUInteger count = events.count; [panels colorChanged:panel]; assert(events.count == count);
  // The user closing the panel ends the session as dismissed.
  Call(panels, @"colorPanel.show", @{ @"sessionId": @"c3", @"color": @"#123456", @"alpha": @NO, @"mode": @"rgb" });
  assert(panel.mode == NSColorPanelModeRGB);
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:panel];
  assert(([events.lastObject isEqual:@{ @"type": @"colorPanelClose", @"sessionId": @"c3", @"reason": @"dismissed" }]));
  // Closing an ended session leaves the panel alone; closing the current one hides it without an event.
  int hidden = colorHidden; assert([Call(panels, @"colorPanel.close", @{ @"sessionId": @"c3" }).value isEqual:@"null"] && colorHidden == hidden);
  Call(panels, @"colorPanel.show", @{ @"sessionId": @"c4", @"color": @"", @"alpha": @NO, @"mode": @"" }); count = events.count;
  Call(panels, @"colorPanel.close", @{ @"sessionId": @"c4" }); assert(colorHidden == hidden + 1 && events.count == count && [panel valueForKey:@"target"] == nil);

  // Font: a typed descriptor resolves to an installed font; the panel converts it; unknown families reject.
  NSFontManager *manager = NSFontManager.sharedFontManager;
  Result font = Call(panels, @"fontPanel.show", @{ @"sessionId": @"f1", @"family": @"Helvetica Neue", @"size": @14, @"weight": @700, @"italic": @NO });
  NSDictionary *resolved = JSON(font.value);
  assert([resolved[@"family"] isEqual:@"Helvetica Neue"] && [resolved[@"weight"] isEqual:@700] && [resolved[@"italic"] isEqual:@NO] && [resolved[@"size"] isEqual:@14]);
  assert([resolved[@"postScriptName"] isEqual:@"HelveticaNeue-Bold"] && manager.target == panels && fontShown == 1 && [manager.selectedFont.fontName isEqual:@"HelveticaNeue-Bold"]);
  for (NSNumber *weight in @[@300, @400]) {
    NSDictionary *light = JSON(Call(panels, @"fontPanel.show", @{ @"sessionId": @"probe", @"family": @"Helvetica Neue", @"size": @12, @"weight": weight, @"italic": @YES }).value);
    assert([light[@"weight"] isEqual:weight] && [light[@"italic"] isEqual:@YES]);
  }
  assert(([events.lastObject isEqual:@{ @"type": @"fontPanelClose", @"sessionId": @"probe", @"reason": @"replaced" }]));
  Call(panels, @"fontPanel.show", @{ @"sessionId": @"f2", @"family": @"Helvetica Neue", @"size": @14, @"weight": @700, @"italic": @NO });
  // The font panel's own trait action: the manager sends changeFont: to its target, which converts.
  NSMenuItem *italic = [NSMenuItem new]; italic.tag = NSItalicFontMask; [manager addFontTrait:italic];
  NSDictionary *change = events.lastObject;
  assert([change[@"type"] isEqual:@"fontPanelChange"] && [change[@"sessionId"] isEqual:@"f2"]);
  assert([change[@"font"][@"family"] isEqual:@"Helvetica Neue"] && [change[@"font"][@"italic"] isEqual:@YES] && [change[@"font"][@"weight"] isEqual:@700]);
  NSMenuItem *larger = [NSMenuItem new]; larger.tag = NSSizeUpFontAction; [manager modifyFont:larger];
  assert([events.lastObject[@"font"][@"size"] doubleValue] > 14 && [events.lastObject[@"font"][@"italic"] isEqual:@YES]);
  Result missing = Call(panels, @"fontPanel.show", @{ @"sessionId": @"f3", @"family": @"No Such Family Spark", @"size": @12, @"weight": @400, @"italic": @NO });
  assert([missing.code isEqual:@"E_NOT_FOUND"] && manager.target == panels);
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:[manager fontPanel:NO]];
  assert(([events.lastObject isEqual:@{ @"type": @"fontPanelClose", @"sessionId": @"f2", @"reason": @"dismissed" }]) && manager.target == nil);
  Call(panels, @"fontPanel.show", @{ @"sessionId": @"f4", @"family": @"Menlo", @"size": @11, @"weight": @400, @"italic": @NO }); count = events.count;
  Call(panels, @"fontPanel.close", @{ @"sessionId": @"f4" }); assert(fontHidden == 1 && events.count == count && manager.target == nil);

  // Eyedropper: an opaque sRGB color, or a distinct cancellation.
  sampled = [NSColor colorWithDisplayP3Red:1 green:0 blue:0 alpha:1];
  NSDictionary *pick = JSON(Call(panels, @"sampleScreenColor", @{}).value);
  assert(samplerUsed == 1 && [pick[@"canceled"] isEqual:@NO] && [pick[@"color"] length] == 7);
  sampled = nil; assert(([JSON(Call(panels, @"sampleScreenColor", @{}).value) isEqual:@{ @"canceled": @YES }]));
  assert([Call(panels, @"nope", @{}).code isEqual:@"E_INVALID_ARGUMENT"]);
  // One sampler at a time: a second request while the user samples is busy; the first still answers.
  holdSample = YES; __block id first = nil;
  [panels call:@"sampleScreenColor" args:@"{}" resolve:^(id value) { first = value; } reject:^(NSString *code, NSString *message, NSError *error) { assert(false); }];
  assert([Call(panels, @"sampleScreenColor", @{}).code isEqual:@"E_BUSY"] && samplerUsed == 3 && !first);
  heldSample(nil); assert([JSON(first) isEqual:@{ @"canceled": @YES }]);
  holdSample = NO; sampled = NSColor.blueColor; assert([JSON(Call(panels, @"sampleScreenColor", @{}).value)[@"canceled"] isEqual:@NO] && samplerUsed == 4);

  // Driver mode never shows a panel or starts the sampler: each refuses as unavailable, and an
  // invalid request still reports its own error first.
  driverActive = YES; int shownBefore = colorShown + fontShown, samplesBefore = samplerUsed; count = events.count;
  for (NSString *method in @[@"colorPanel.show", @"fontPanel.show", @"sampleScreenColor"]) {
    Result refused = Call(panels, method, @{ @"sessionId": @"d1", @"color": @"", @"alpha": @NO, @"mode": @"", @"family": @"Menlo", @"size": @11, @"weight": @400, @"italic": @NO });
    assert([refused.code isEqual:@"E_UNAVAILABLE"] && [refused.message containsString:@"test driver"]);
  }
  assert(colorShown + fontShown == shownBefore && samplerUsed == samplesBefore && events.count == count && manager.target == nil && [panel valueForKey:@"target"] == nil);
  assert([Call(panels, @"colorPanel.show", @{ @"sessionId": @"d2", @"color": @"", @"alpha": @NO, @"mode": @"crayons" }).code isEqual:@"E_INVALID_ARGUMENT"]);
  assert([Call(panels, @"fontPanel.show", @{ @"sessionId": @"d3", @"family": @"No Such Family Spark", @"size": @12, @"weight": @400, @"italic": @NO }).code isEqual:@"E_NOT_FOUND"]);
  driverActive = NO;

  // Observers live only as long as a session: once it ends, panel closes and handovers report nothing.
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:panel];
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:[manager fontPanel:NO]];
  [NSNotificationCenter.defaultCenter postNotificationName:SparkColorPanelOwnerWillChange object:[NSObject new]];
  assert(events.count == count);

  // Reload: sessions end silently, and the panels this module owned leave the screen.
  int colorHiddenBefore = colorHidden, fontHiddenBefore = fontHidden;
  Call(panels, @"colorPanel.show", @{ @"sessionId": @"c5", @"color": @"", @"alpha": @NO, @"mode": @"" });
  Call(panels, @"fontPanel.show", @{ @"sessionId": @"f5", @"family": @"Menlo", @"size": @11, @"weight": @400, @"italic": @NO });
  count = events.count; [panels invalidate];
  assert(events.count == count && [panel valueForKey:@"target"] == nil && manager.target == nil);
  assert(colorHidden == colorHiddenBefore + 1 && fontHidden == fontHiddenBefore + 1);
  // A module with no session leaves panels another owner may be using.
  [[RNSparkPanels new] invalidate]; assert(colorHidden == colorHiddenBefore + 1 && fontHidden == fontHiddenBefore + 1);
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:panel];
  [NSNotificationCenter.defaultCenter postNotificationName:SparkColorPanelOwnerWillChange object:[NSObject new]];
  assert(events.count == count);
  puts("Native panel tests passed");
} }
