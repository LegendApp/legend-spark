#import <AppKit/AppKit.h>
#import <react/renderer/core/LayoutMetrics.h>

// Fabric resolves each node's layout direction, including one inherited from a React `direction` style.
// AppKit views take the app's direction instead, so every Spark component view that hosts AppKit views
// applies this one to them from updateLayoutMetrics.
static inline NSUserInterfaceLayoutDirection RNSparkLayoutDirection(const facebook::react::LayoutMetrics &layoutMetrics)
{
  return layoutMetrics.layoutDirection == facebook::react::LayoutDirection::RightToLeft
    ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
}

// AppKit resolves natural text alignment from the app's language, not from the view's direction.
static inline NSTextAlignment RNSparkLeadingTextAlignment(NSUserInterfaceLayoutDirection direction)
{
  return direction == NSUserInterfaceLayoutDirectionRightToLeft ? NSTextAlignmentRight : NSTextAlignmentLeft;
}
