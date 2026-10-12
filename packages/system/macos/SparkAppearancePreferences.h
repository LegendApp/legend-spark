#import <Foundation/Foundation.h>

// The user's appearance and accessibility display preferences (docs/system.md#appearance-preferences).
// Main thread only. Needs no React Native, so tests/appearance-preferences.native.mm runs it directly.

// { appearance, automaticAppearance, accentColor, highlightColor, increaseContrast, reduceTransparency, reduceMotion,
// differentiateWithoutColor, invertColors, keyboardNavigation }, with any simulated values in place of the real ones.
// nil, with `error` set, when a system color has no sRGB form.
FOUNDATION_EXPORT NSDictionary *SparkAppearancePreferences(NSString **error);
// Test driver only: replaces the reported value of these fields until the process quits. The OS is untouched.
FOUNDATION_EXPORT void SparkSimulateAppearancePreferences(NSDictionary *values);
