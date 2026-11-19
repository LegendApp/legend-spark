#import "RNSparkPaneSplitView.h"
#include <algorithm>
#include <limits>
#include <unordered_map>

namespace {

struct SizeLimits {
  CGFloat min;
  CGFloat max;
};

CGFloat extent(NSRect frame, BOOL horizontal)
{
  return horizontal ? NSWidth(frame) : NSHeight(frame);
}

CGFloat end(NSRect frame, BOOL horizontal)
{
  return horizontal ? NSMaxX(frame) : NSMaxY(frame);
}

std::vector<SizeLimits> limitsFor(const std::vector<RNSparkSplitPaneSizing> &panes, CGFloat available)
{
  std::vector<SizeLimits> limits;
  CGFloat minTotal = 0;
  CGFloat maxTotal = 0;
  for (const auto &pane : panes) {
    CGFloat max = pane.maxSize >= 0 ? pane.maxSize : std::numeric_limits<CGFloat>::infinity();
    limits.push_back({pane.minSize, max});
    minTotal += pane.minSize;
    maxTotal += max;
  }
  if (minTotal > available) {
    // A window can be smaller than the sum of the minima. Compress them proportionally until it grows again.
    CGFloat largestMin = std::ranges::max(limits, {}, &SizeLimits::min).min;
    CGFloat scaledTotal = 0;
    for (auto &limit : limits) scaledTotal += limit.min / largestMin;
    for (auto &limit : limits) limit.min = (limit.min / largestMin) * (available / scaledTotal);
  } else if (!limits.empty() && maxTotal < available) {
    limits.back().max += available - maxTotal;
  }
  return limits;
}

std::vector<CGFloat> fitSizes(const std::vector<CGFloat> &preferences, const std::vector<SizeLimits> &limits, CGFloat available)
{
  std::vector<CGFloat> sizes;
  CGFloat remainder = available;
  size_t unspecified = 0;
  for (size_t i = 0; i < preferences.size(); ++i) {
    CGFloat preferred = preferences[i];
    if (preferred < 0) ++unspecified;
    CGFloat size = std::clamp(preferred, limits[i].min, std::min(limits[i].max, available));
    sizes.push_back(size);
    remainder -= size;
  }
  for (size_t i = 0; i < sizes.size(); ++i) {
    if (preferences[i] >= 0) continue;
    CGFloat growth = std::clamp(remainder / unspecified--, CGFloat{0}, limits[i].max - sizes[i]);
    sizes[i] += growth;
    remainder -= growth;
  }
  // The last pane absorbs remaining space first, then each preceding pane up to its bounds.
  for (size_t i = sizes.size(); i > 0; --i) {
    size_t index = i - 1;
    CGFloat change = std::clamp(remainder, limits[index].min - sizes[index], limits[index].max - sizes[index]);
    sizes[index] += change;
    remainder -= change;
  }
  return sizes;
}

}

@interface RNSparkPaneSplitView () <NSSplitViewDelegate>
@end

@implementation RNSparkPaneSplitView {
  std::vector<RNSparkSplitPaneSizing> _panes;
  std::unordered_map<std::string, CGFloat> _preferredSizes;
  std::vector<SizeLimits> _limits;
  BOOL _applyingFrames;
  BOOL _trackingDivider;
}

- (instancetype)initWithFrame:(NSRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.delegate = self;
    self.arrangesAllSubviews = NO;
    self.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionLeftToRight;
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

- (CGFloat)dividerThickness
{
  size_t count = self.arrangedSubviews.count;
  return count > 1 ? MIN(super.dividerThickness, extent(self.bounds, self.vertical) / (count - 1)) : super.dividerThickness;
}

- (NSColor *)dividerColor
{
  return self.dividerStyle == NSSplitViewDividerStyleThin ? NSColor.separatorColor : super.dividerColor;
}

- (void)configurePanes:(const std::vector<RNSparkSplitPaneSizing> &)panes
            horizontal:(BOOL)horizontal
          dividerStyle:(NSSplitViewDividerStyle)style
{
  _applyingFrames = YES;
  if (horizontal != self.vertical) {
    _preferredSizes.clear();
  } else {
    std::unordered_map<std::string, CGFloat> retained;
    for (const auto &pane : panes) {
      if (auto existing = _preferredSizes.find(pane.id); existing != _preferredSizes.end()) {
        retained.emplace(pane.id, existing->second);
      }
    }
    _preferredSizes.swap(retained);
  }
  _panes = panes;
  self.vertical = horizontal;
  self.dividerStyle = style;
  _applyingFrames = NO;
  [self adjustSubviews];
}

- (void)adjustSubviews
{
  NSArray<NSView *> *views = self.arrangedSubviews;
  if (_applyingFrames || views.count != _panes.size()) return;
  _applyingFrames = YES;

  NSRect bounds = self.bounds;
  BOOL horizontal = self.vertical;
  CGFloat divider = self.dividerThickness;
  CGFloat available = MAX(0, extent(bounds, horizontal) - divider * (views.count ? views.count - 1 : 0));
  _limits = limitsFor(_panes, available);
  std::vector<CGFloat> preferences;
  for (const auto &pane : _panes) {
    auto existing = _preferredSizes.find(pane.id);
    preferences.push_back(existing != _preferredSizes.end() ? existing->second : pane.initialSize);
  }
  auto sizes = fitSizes(preferences, _limits, available);
  CGFloat origin = 0;
  for (NSUInteger i = 0; i < views.count; ++i) {
    CGFloat size = sizes[i];
    views[i].frame = horizontal ? NSMakeRect(origin, 0, size, NSHeight(bounds)) : NSMakeRect(0, origin, NSWidth(bounds), size);
    _preferredSizes.try_emplace(_panes[i].id, preferences[i]);
    origin += size + divider;
  }
  _applyingFrames = NO;
  [self.window invalidateCursorRectsForView:self];
  [self setNeedsDisplay:YES];
  if (self.onLayout) self.onLayout();
}

- (void)splitView:(NSSplitView *)splitView resizeSubviewsWithOldSize:(NSSize)oldSize
{
  [self adjustSubviews];
}

- (CGFloat)splitView:(NSSplitView *)splitView constrainMinCoordinate:(CGFloat)minimum ofSubviewAt:(NSInteger)index
{
  NSArray<NSView *> *views = self.arrangedSubviews;
  if (index < 0 || index + 1 >= (NSInteger)_limits.size() || views.count != _limits.size()) return minimum;
  CGFloat adjacentEnd = end(views[index + 1].frame, self.vertical);
  return MAX(minimum + _limits[index].min, adjacentEnd - self.dividerThickness - _limits[index + 1].max);
}

- (CGFloat)splitView:(NSSplitView *)splitView constrainMaxCoordinate:(CGFloat)maximum ofSubviewAt:(NSInteger)index
{
  NSArray<NSView *> *views = self.arrangedSubviews;
  if (index < 0 || index + 1 >= (NSInteger)_limits.size() || views.count != _limits.size()) return maximum;
  CGFloat leadingOrigin = end(views[index].frame, self.vertical) - extent(views[index].frame, self.vertical);
  return MIN(maximum - _limits[index + 1].min, leadingOrigin + _limits[index].max);
}

- (void)splitViewDidResizeSubviews:(NSNotification *)notification
{
  NSArray<NSView *> *views = self.arrangedSubviews;
  if (_applyingFrames || !_trackingDivider || views.count != _panes.size()) return;
  for (NSUInteger i = 0; i < views.count; ++i) {
    _preferredSizes[_panes[i].id] = extent(views[i].frame, self.vertical);
  }
  if (self.onLayout) self.onLayout();
}

- (void)setPosition:(CGFloat)position ofDividerAtIndex:(NSInteger)index
{
  BOOL tracking = _trackingDivider;
  _trackingDivider = YES;
  [super setPosition:position ofDividerAtIndex:index];
  _trackingDivider = tracking;
}

- (void)mouseDown:(NSEvent *)event
{
  _trackingDivider = YES;
  [super mouseDown:event];
  _trackingDivider = NO;
}

- (NSView *)hitTest:(NSPoint)point
{
  if (_trackingDivider) {
    return NSPointInRect([self convertPoint:point fromView:self.superview], self.bounds) ? self : nil;
  }
  return [super hitTest:point];
}
@end
