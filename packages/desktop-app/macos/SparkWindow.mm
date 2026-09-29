#import "SparkDesktop.h"
#import <objc/runtime.h>
static char optionsKey;
NSDictionary *SparkWindowConfiguration(void) {
#if DEBUG
  if ([SparkContext()[@"runtime"][@"mode"] isEqual:@"go"]) {
    NSString *json = NSProcessInfo.processInfo.environment[@"SPARK_WINDOW_CONFIG"];
    return json ? SparkArgs(json) : @{};
  }
#endif
  return [NSBundle.mainBundle objectForInfoDictionaryKey:@"SparkWindowConfiguration"] ?: @{};
}
NSView *SparkWindowContent(NSView *root) {
  NSVisualEffectView *content = [[NSVisualEffectView alloc] initWithFrame:root.frame];
  content.material = NSVisualEffectMaterialWindowBackground;
  content.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  content.state = NSVisualEffectStateFollowsWindowActiveState;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:root];
  return content;
}
void SparkApplyWindowOptions(NSWindow *window, NSDictionary *patch) {
  NSMutableDictionary *options = [objc_getAssociatedObject(window, &optionsKey) mutableCopy] ?: [NSMutableDictionary new];
  [options addEntriesFromDictionary:patch];
  objc_setAssociatedObject(window, &optionsKey, options, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  NSString *style = options[@"titleBarStyle"] ?: @"default";
  NSWindowStyleMask mask = [style isEqual:@"borderless"] ? NSWindowStyleMaskBorderless : NSWindowStyleMaskTitled;
  if ([window isKindOfClass:NSPanel.class]) mask |= NSWindowStyleMaskNonactivatingPanel;
  if (!options[@"resizable"] || [options[@"resizable"] boolValue]) mask |= NSWindowStyleMaskResizable;
  if (!options[@"closable"] || [options[@"closable"] boolValue]) mask |= NSWindowStyleMaskClosable;
  if (!options[@"minimizable"] || [options[@"minimizable"] boolValue]) mask |= NSWindowStyleMaskMiniaturizable;
  if ([style isEqual:@"overlay"] || [style isEqual:@"hidden"]) mask |= NSWindowStyleMaskFullSizeContentView;
  window.styleMask = mask | (window.styleMask & NSWindowStyleMaskFullScreen);
  window.titlebarAppearsTransparent = ![style isEqual:@"default"];
  window.titleVisibility = [style isEqual:@"default"] ? NSWindowTitleVisible : NSWindowTitleHidden;
  BOOL hideButtons = [style isEqual:@"hidden"] || (options[@"trafficLights"] && ![options[@"trafficLights"] boolValue]);
  for (NSNumber *button in @[@(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton)]) [window standardWindowButton:(NSWindowButton)button.integerValue].hidden = hideButtons;
  window.level = [options[@"alwaysOnTop"] boolValue] ? ([window isKindOfClass:NSPanel.class] ? NSStatusWindowLevel : NSFloatingWindowLevel) : NSNormalWindowLevel;
  window.hasShadow = !options[@"hasShadow"] || [options[@"hasShadow"] boolValue];
  window.opaque = ![options[@"transparent"] boolValue];
  NSString *appearance = options[@"appearance"];
  window.appearance = [appearance isEqual:@"dark"] ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua] : [appearance isEqual:@"light"] ? [NSAppearance appearanceNamed:NSAppearanceNameAqua] : nil;
  NSString *color = options[@"backgroundColor"];
  NSColor *background = window.opaque ? NSColor.windowBackgroundColor : NSColor.clearColor;
  if (color.length == 7 || color.length == 9) {
    unsigned long long rgba = 0; [[NSScanner scannerWithString:[color substringFromIndex:1]] scanHexLongLong:&rgba];
    if (color.length == 7) rgba = (rgba << 8) | 255;
    background = [NSColor colorWithSRGBRed:((rgba >> 24) & 255) / 255.0 green:((rgba >> 16) & 255) / 255.0 blue:((rgba >> 8) & 255) / 255.0 alpha:(rgba & 255) / 255.0];
  }
  window.backgroundColor = background;
  NSDictionary *materials = @{ @"sidebar": @(NSVisualEffectMaterialSidebar), @"windowBackground": @(NSVisualEffectMaterialWindowBackground), @"hudWindow": @(NSVisualEffectMaterialHUDWindow), @"popover": @(NSVisualEffectMaterialPopover) };
  if ([window.contentView isKindOfClass:NSVisualEffectView.class]) {
    NSVisualEffectView *view = (NSVisualEffectView *)window.contentView;
    NSNumber *material = materials[options[@"material"] ?: @"none"];
    view.material = material ? (NSVisualEffectMaterial)material.integerValue : NSVisualEffectMaterialWindowBackground;
    // Disable the effect without hiding the content's React subview.
    view.state = material ? NSVisualEffectStateFollowsWindowActiveState : NSVisualEffectStateInactive;
    view.blendingMode = material ? NSVisualEffectBlendingModeBehindWindow : NSVisualEffectBlendingModeWithinWindow;
    view.wantsLayer = YES;
    view.layer.backgroundColor = material ? NSColor.clearColor.CGColor : background.CGColor;
  }
  window.minSize = NSMakeSize(options[@"minWidth"] ? [options[@"minWidth"] doubleValue] : 100, options[@"minHeight"] ? [options[@"minHeight"] doubleValue] : 100);
  window.maxSize = NSMakeSize(options[@"maxWidth"] ? [options[@"maxWidth"] doubleValue] : 20000, options[@"maxHeight"] ? [options[@"maxHeight"] doubleValue] : 20000);
  NSSize size = window.frame.size;
  if (patch[@"width"]) size.width = [patch[@"width"] doubleValue];
  if (patch[@"height"]) size.height = [patch[@"height"] doubleValue];
  size.width = MIN(MAX(size.width, window.minSize.width), window.maxSize.width);
  size.height = MIN(MAX(size.height, window.minSize.height), window.maxSize.height);
  NSRect frame = window.frame;
  frame.origin.y += frame.size.height - size.height;
  frame.size = size;
  [window setFrame:frame display:NO];
  if (options[@"title"]) window.title = options[@"title"];
}
void SparkRestoreWindow(NSWindow *window, NSString *key, NSDictionary *options) {
  [window center];
  if ([options[@"restoreFrame"] boolValue]) {
    NSString *name = [NSString stringWithFormat:@"%@.%@", SparkNamespace(), key];
    [window setFrameUsingName:name]; [window setFrameAutosaveName:name];
    // Restored dimensions respect current constraints, rather than overriding them.
    SparkApplyWindowOptions(window, @{});
    [window setFrame:[window constrainFrameRect:window.frame toScreen:window.screen ?: NSScreen.mainScreen] display:NO];
  }
}
