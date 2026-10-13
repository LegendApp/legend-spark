#import <Foundation/Foundation.h>

// Window transitions the window module (packages/desktop-windows) posts on the main thread for other modules; `object`
// is the NSWindow. Motion's cross-window shared elements follow them (docs/motion.md#cross-window-shared-elements).

/** A Spark window that was not shown starts to show (openWindow, openWindowFrom's zoom, showWindow, a pool reuse). */
static NSNotificationName const SparkWindowShowingNotification = @"SparkWindowShowingNotification";
/**
 * A Spark window starts to leave the screen: its close transition starts shrinking it, or it is parked in its pool.
 * userInfo `departing` is NO when an interrupted shrink cancels the close, or a parked window is used again.
 */
static NSNotificationName const SparkWindowDepartureNotification = @"SparkWindowDepartureNotification";
