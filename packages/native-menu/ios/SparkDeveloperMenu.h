#import <AppKit/AppKit.h>
#import <React/RCTDefines.h>

// The native half of the Developer menu (src/developer-menu.ts). Development builds only: release builds
// (RCT_DEV 0) compile none of it, and their JavaScript bundles never publish `_sparkDev` items.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN

typedef void (^SparkDeveloperEmit)(NSDictionary *body);

// The JavaScript runtime that renders `window`: {runtime: "isolated", name} when it hosts a Spark isolated window
// surface, {runtime: "shared"} when it hosts any other React Native surface, and nil otherwise.
FOUNDATION_EXPORT NSDictionary *_Nullable SparkDeveloperTarget(NSWindow *_Nullable window);
// Applies an item's `_sparkDev` instruction when it is installed.
FOUNDATION_EXPORT void SparkDeveloperConfigure(NSMenuItem *item, NSDictionary *instruction);
// Menu validation against the key window's runtime: whether the item is enabled, and its checkmark.
FOUNDATION_EXPORT BOOL SparkDeveloperValidate(NSMenuItem *item, NSDictionary *instruction);
// Runs the item. Open DevTools has no native implementation here: `emit` hands it to JavaScript with its target.
FOUNDATION_EXPORT void SparkDeveloperPerform(NSMenuItem *item, NSDictionary *instruction, SparkDeveloperEmit emit);

NS_ASSUME_NONNULL_END
#endif
