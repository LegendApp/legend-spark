#import <Foundation/Foundation.h>

// The user's appearance and accessibility display preferences (docs/system.md#appearance-preferences).
// Main thread only. Needs no React Native, so tests/appearance-preferences.native.mm runs it directly.

// { appearance, automaticAppearance, accentColor, highlightColor, increaseContrast, reduceTransparency, reduceMotion,
// differentiateWithoutColor, invertColors, keyboardNavigation }.
// nil, with `error` set, when a system color has no sRGB form.
FOUNDATION_EXPORT NSDictionary *SparkAppearancePreferences(NSString **error);
