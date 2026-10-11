#import <React/RCTViewComponentView.h>
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

/** An NSTableView or NSOutlineView of text cells, fed by row JSON chunks and controlled by event-count acknowledgment. */
@interface RNSparkTable : RCTViewComponentView <NSTableViewDataSource, NSTableViewDelegate, NSOutlineViewDataSource, NSOutlineViewDelegate>
@end

NS_ASSUME_NONNULL_END
