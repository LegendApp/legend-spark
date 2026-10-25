#import "SparkAppearancePreferences.h"
#import <AppKit/AppKit.h>

// sRGB #rrggbb of a dynamic system color, resolved in the app's effective appearance; nil without an sRGB form.
static NSString *Hex(NSColor *color) {
  __block NSColor *rgb;
  [NSApp.effectiveAppearance performAsCurrentDrawingAppearance:^{ rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace]; }];
  if (!rgb) return nil;
  int (^byte)(CGFloat) = ^int(CGFloat component) { return (int)lround(fmin(1, fmax(0, component)) * 255); };
  return [NSString stringWithFormat:@"#%02x%02x%02x", byte(rgb.redComponent), byte(rgb.greenComponent), byte(rgb.blueComponent)];
}

NSDictionary *SparkAppearancePreferences(NSString **error) {
  NSString *accent = Hex(NSColor.controlAccentColor), *highlight = Hex(NSColor.selectedTextBackgroundColor);
  if (!accent || !highlight) { *error = @"The accent or highlight color has no sRGB form"; return nil; }
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
  return @{
    // System Settings > Appearance, not the app's own appearance: AppleInterfaceStyle is set only while dark.
    @"appearance": [[defaults stringForKey:@"AppleInterfaceStyle"] isEqualToString:@"Dark"] ? @"dark" : @"light",
    @"automaticAppearance": @([defaults boolForKey:@"AppleInterfaceStyleSwitchesAutomatically"]),
    @"accentColor": accent,
    @"highlightColor": highlight,
    @"increaseContrast": @(workspace.accessibilityDisplayShouldIncreaseContrast),
    @"reduceTransparency": @(workspace.accessibilityDisplayShouldReduceTransparency),
    @"reduceMotion": @(workspace.accessibilityDisplayShouldReduceMotion),
    @"differentiateWithoutColor": @(workspace.accessibilityDisplayShouldDifferentiateWithoutColor),
    @"invertColors": @(workspace.accessibilityDisplayShouldInvertColors),
    @"keyboardNavigation": @(NSApp.isFullKeyboardAccessEnabled),
  };
}
