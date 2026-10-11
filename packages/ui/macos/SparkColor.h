#import <AppKit/AppKit.h>

// Posted with the new owner as object by whoever takes the shared NSColorPanel (a ColorWell
// activating, or showColorPanel). Every other owner lets go, so one color edit never reaches two.
static NSNotificationName const SparkColorPanelOwnerWillChange = @"SparkColorPanelOwnerWillChange";

// sRGB hex, lowercase: #rrggbb, or #rrggbbaa with alpha. Nil when the color has no sRGB form (a pattern).
static inline NSString *SparkHexFromColor(NSColor *color, BOOL alpha) {
  NSColor *rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  if (!rgb) return nil;
  int (^byte)(CGFloat) = ^int(CGFloat component) { return (int)lround(fmin(1, fmax(0, component)) * 255); };
  NSString *hex = [NSString stringWithFormat:@"#%02x%02x%02x", byte(rgb.redComponent), byte(rgb.greenComponent), byte(rgb.blueComponent)];
  return alpha ? [hex stringByAppendingFormat:@"%02x", byte(rgb.alphaComponent)] : hex;
}
// JS validated the format; an absent alpha byte is opaque.
static inline NSColor *SparkColorFromHex(NSString *hex) {
  unsigned long long value = 0;
  [[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexLongLong:&value];
  if (hex.length == 7) value = (value << 8) | 0xff;
  return [NSColor colorWithSRGBRed:((value >> 24) & 0xff) / 255.0 green:((value >> 16) & 0xff) / 255.0 blue:((value >> 8) & 0xff) / 255.0 alpha:(value & 0xff) / 255.0];
}
