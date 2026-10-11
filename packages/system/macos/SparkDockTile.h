// Dock tile progress without React Native, so native tests can render it directly.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN
/// The app icon with a progress bar along its lower edge. The Dock draws the tile's badgeLabel on
/// top of a custom content view, so the bar stays clear of the badge corner (top right).
@interface SparkDockProgressView : NSView
/// "normal", "paused", "error" or "indeterminate".
@property (nonatomic, copy) NSString *state;
/// The completed fraction from 0 to 1; indeterminate progress ignores it.
@property (nonatomic) double value;
/// Where the bar sits, in the view's coordinates.
@property (nonatomic, readonly) NSRect trackRect;
/// The bar's fill for the current state, resolved in the view's appearance.
@property (nonatomic, readonly) NSColor *fillColor;
@end

/// Shows `progress` ({ state, value }) on `tile`, reusing its progress view, or restores the tile's
/// previous content view for nil. The view follows the system appearance and accent color while installed.
FOUNDATION_EXPORT void SparkSetDockProgress(NSDockTile *tile, NSDictionary *_Nullable progress);
NS_ASSUME_NONNULL_END
