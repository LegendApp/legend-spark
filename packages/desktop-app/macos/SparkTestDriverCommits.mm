#import "SparkTestDriverPrivate.h"
#include <libproc.h>
#include <mach/mach.h>

// Layout and flicker watching (docs/test-driver.md#layout-thrash-and-flicker). Between startCommits and stopCommits,
// each time the main run loop commits its Core Animation transaction (an observer ordered after Core Animation's,
// before the run loop waits or exits), the driver walks every window's views: the model the next frame shows. A commit
// that changed no view frame and no visible element is not counted. It reports:
// - relayouts: views whose frame (in their superview) changed in more than one commit. The frame a view has when it
//   is mounted, or when watching starts, is not a change.
// - gaps: elements (views with a testID) visible, then not visible for one or more commits, then visible again. A view
//   is visible when neither it nor an ancestor is hidden or has alpha 0, and it has an area.
// - blanks: commits in which a window that showed elements showed none.
@interface SparkDriverViewRecord : NSObject
@property (nonatomic) NSRect frame;
@property (nonatomic, strong) NSMutableArray *frames;
@property (nonatomic) NSInteger changes;
@property (nonatomic, copy) NSString *view, *window;
@end
@implementation SparkDriverViewRecord
@end

static NSDictionary *SparkRect(NSRect rect) { return @{ @"x": @(rect.origin.x), @"y": @(rect.origin.y), @"width": @(rect.size.width), @"height": @(rect.size.height) }; }
static NSString *SparkTestID(NSView *view) { NSString *value = view.accessibilityIdentifier; return value.length ? value : nil; }

@interface SparkDriverCommitWatch : NSObject
@property (nonatomic) CFRunLoopObserverRef observer;
@property (nonatomic, strong) NSMapTable<NSView *, SparkDriverViewRecord *> *views;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSSet<NSString *> *> *visible; // window -> visible testIDs
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *missingSince;    // "window testID" -> commit
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *blankSince;      // window -> commit
@property (nonatomic, strong) NSMutableArray *gaps, *blanks;
@property (nonatomic) NSInteger commits;
@property (nonatomic) BOOL changed;
@end
@implementation SparkDriverCommitWatch
// Records frames under `view` and returns whether it or a descendant is visible, adding visible testIDs to `ids`.
- (void)walk:(NSView *)view shown:(BOOL)shown window:(NSString *)window within:(NSString *)within ids:(NSMutableSet *)ids {
  shown = shown && !view.isHidden && view.alphaValue > 0;
  NSString *testID = SparkTestID(view);
  SparkDriverViewRecord *record = [_views objectForKey:view];
  if (!record) {
    record = [SparkDriverViewRecord new];
    record.frame = view.frame; record.frames = [NSMutableArray arrayWithObject:SparkRect(view.frame)]; record.window = window;
    record.view = testID ?: within ? [NSString stringWithFormat:@"%@ in %@", NSStringFromClass(view.class), within] : NSStringFromClass(view.class);
    [_views setObject:record forKey:view];
  } else if (!NSEqualRects(record.frame, view.frame)) {
    record.frame = view.frame; record.changes++; _changed = YES;
    if (record.frames.count < 8) [record.frames addObject:SparkRect(view.frame)];
  }
  if (testID && shown && view.frame.size.width > 0 && view.frame.size.height > 0) [ids addObject:testID];
  for (NSView *child in view.subviews) [self walk:child shown:shown window:window within:testID ?: within ids:ids];
}
- (void)snapshot {
  NSMutableDictionary<NSString *, NSSet<NSString *> *> *visible = [NSMutableDictionary new];
  for (NSWindow *window in NSApp.windows) {
    NSString *identifier = window.identifier;
    if (!identifier.length || !window.contentView || visible[identifier]) continue;
    NSMutableSet *ids = [NSMutableSet new];
    [self walk:window.contentView shown:YES window:identifier within:nil ids:ids];
    visible[identifier] = ids;
  }
  if (_visible && !_changed && [visible isEqualToDictionary:_visible]) return;
  _changed = NO;
  if (!_visible) { _visible = visible; return; } // The state watching starts from.
  _commits++;
  for (NSString *window in visible) {
    NSSet *before = _visible[window], *now = visible[window];
    for (NSString *testID in before)
      if (![now containsObject:testID] && !_missingSince[[window stringByAppendingFormat:@" %@", testID]]) _missingSince[[window stringByAppendingFormat:@" %@", testID]] = @(_commits);
    for (NSString *testID in now) {
      NSString *key = [window stringByAppendingFormat:@" %@", testID];
      NSNumber *since = _missingSince[key];
      if (!since) continue;
      [_missingSince removeObjectForKey:key];
      [_gaps addObject:@{ @"id": testID, @"window": window, @"commits": @(_commits - since.integerValue) }];
    }
    if (before.count && !now.count && !_blankSince[window]) _blankSince[window] = @(_commits);
    if (now.count && _blankSince[window]) {
      [_blanks addObject:@{ @"window": window, @"commits": @(_commits - _blankSince[window].integerValue) }];
      [_blankSince removeObjectForKey:window];
    }
  }
  _visible = visible;
}
@end

static SparkDriverCommitWatch *watch;

NSArray<NSString *> *SparkDriverCommitCommandNames(void) {
  static NSArray *names = @[@"startCommits", @"stopCommits", @"counters", @"memory"];
  return names;
}

static NSUInteger SparkCountViews(NSView *view) {
  NSUInteger count = 1;
  for (NSView *child in view.subviews) count += SparkCountViews(child);
  return count;
}

void SparkDriverCommits(NSString *command, NSDictionary *request, SparkTestDriverReply reply) {
  if ([command isEqual:@"memory"]) {
    task_vm_info_data_t info = {};
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) { reply(SparkDriverFailure(@"E_UNAVAILABLE", @"task_info did not report this process's memory")); return; }
    reply(@{ @"ok": @YES, @"footprintMB": @(info.phys_footprint / 1048576.0), @"residentMB": @(info.resident_size / 1048576.0) });
    return;
  }
  if ([command isEqual:@"counters"]) {
    SparkDriverWhenSettled(request[@"timeoutMs"], ^(BOOL settled) {
      if (!settled) { reply(SparkDriverFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
      NSUInteger views = 0;
      for (NSWindow *window in NSApp.windows) views += SparkCountViews(SparkDriverFrameView(window));
      int bytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
      if (bytes <= 0) { reply(SparkDriverFailure(@"E_UNAVAILABLE", @"proc_pidinfo did not list this process's file descriptors")); return; }
      NSMutableData *fds = [NSMutableData dataWithLength:(NSUInteger)bytes];
      bytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, fds.mutableBytes, bytes);
      reply(@{ @"ok": @YES, @"windows": @(NSApp.windows.count), @"views": @(views), @"fileDescriptors": @(bytes / (int)sizeof(struct proc_fdinfo)) });
    });
    return;
  }
  if ([command isEqual:@"startCommits"]) {
    if (watch) { reply(SparkDriverFailure(@"E_BUSY", @"Commits are already being watched; stopCommits first")); return; }
    watch = [SparkDriverCommitWatch new];
    watch.views = [NSMapTable weakToStrongObjectsMapTable];
    watch.missingSince = [NSMutableDictionary new]; watch.blankSince = [NSMutableDictionary new];
    watch.gaps = [NSMutableArray new]; watch.blanks = [NSMutableArray new];
    [watch snapshot];
    SparkDriverCommitWatch *owner = watch;
    // Core Animation commits at order 2000000; this runs right after it.
    watch.observer = CFRunLoopObserverCreateWithHandler(NULL, kCFRunLoopBeforeWaiting | kCFRunLoopExit, true, 2000001, ^(CFRunLoopObserverRef, CFRunLoopActivity) { [owner snapshot]; });
    CFRunLoopAddObserver(CFRunLoopGetMain(), watch.observer, kCFRunLoopCommonModes);
    reply(@{ @"ok": @YES });
    return;
  }
  if (!watch) { reply(SparkDriverFailure(@"E_INVALID_STATE", @"Commits are not being watched; startCommits first")); return; }
  SparkDriverCommitWatch *done = watch;
  SparkDriverWhenSettled(request[@"timeoutMs"], ^(BOOL settled) {
    [done snapshot];
    CFRunLoopObserverInvalidate(done.observer);
    CFRelease(done.observer);
    watch = nil;
    if (!settled) { reply(SparkDriverFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
    NSMutableArray *relayouts = [NSMutableArray new];
    for (SparkDriverViewRecord *record in done.views.objectEnumerator)
      if (record.changes > 1) [relayouts addObject:@{ @"view": record.view, @"window": record.window, @"changes": @(record.changes), @"frames": record.frames }];
    reply(@{ @"ok": @YES, @"commits": @(done.commits), @"relayouts": relayouts, @"gaps": done.gaps, @"blanks": done.blanks });
  });
}
