#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef struct {
  NSUInteger matchCount;
  /** 1-based position of the selected match among all matches; 0 when no match was selected. */
  NSUInteger matchIndex;
} SparkTextFindResult;

/** The first text view in `root`'s subtree, skipping field editors (they belong to the field that is editing). */
NSTextView *_Nullable SparkTextServicesTextView(NSView *root);
/** Writing Tools features are supported on this Mac (macOS 15.2+ and capable hardware), even when the user has not enabled them. */
BOOL SparkWritingToolsAvailable(void);
/**
 * Counts the non-overlapping substring matches of `query` and selects the next one after the selection
 * (`backwards`: the last one before it), wrapping to the other end when `wrap`. Without a further match and
 * without `wrap` the selection is unchanged and matchIndex is 0.
 */
SparkTextFindResult SparkTextFind(NSTextView *textView, NSString *query, BOOL caseSensitive, BOOL wrap, BOOL backwards);
/** Shows the NSTextFinder find bar. NO when the text view has no find bar (usesFindBar off or no enclosing scroll view). */
BOOL SparkTextShowFindBar(NSTextView *textView);
/** Shows the Look Up definition for the selection, or for the word at the insertion point. */
void SparkTextLookUp(NSTextView *textView);

NS_ASSUME_NONNULL_END
