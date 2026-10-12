#import "SparkTextServices.h"
#include <vector>

NSTextView *SparkTextServicesTextView(NSView *root)
{
  if ([root isKindOfClass:NSTextView.class] && !((NSTextView *)root).isFieldEditor) return (NSTextView *)root;
  for (NSView *child in root.subviews) {
    NSTextView *found = SparkTextServicesTextView(child);
    if (found) return found;
  }
  return nil;
}

BOOL SparkWritingToolsAvailable(void)
{
  if (@available(macOS 15.2, *)) return NSWritingToolsCoordinator.isWritingToolsAvailable;
  return NO;
}

SparkTextFindResult SparkTextFind(NSTextView *textView, NSString *query, BOOL caseSensitive, BOOL wrap, BOOL backwards)
{
  NSString *text = textView.string;
  const NSStringCompareOptions options = caseSensitive ? 0 : NSCaseInsensitiveSearch;
  std::vector<NSRange> matches;
  for (NSRange remaining = NSMakeRange(0, text.length); remaining.length;) {
    const NSRange match = [text rangeOfString:query options:options range:remaining];
    if (match.location == NSNotFound) break;
    matches.push_back(match);
    remaining = NSMakeRange(NSMaxRange(match), text.length - NSMaxRange(match));
  }
  if (matches.empty()) return {0, 0};
  const NSRange selection = textView.selectedRange;
  NSUInteger index = NSNotFound;
  if (backwards) {
    for (NSUInteger i = matches.size(); i-- > 0;) if (NSMaxRange(matches[i]) <= selection.location) { index = i; break; }
    if (index == NSNotFound && wrap) index = matches.size() - 1;
  } else {
    for (NSUInteger i = 0; i < matches.size(); ++i) if (matches[i].location >= NSMaxRange(selection)) { index = i; break; }
    if (index == NSNotFound && wrap) index = 0;
  }
  if (index == NSNotFound) return {matches.size(), 0};
  textView.selectedRange = matches[index];
  [textView scrollRangeToVisible:matches[index]];
  if (textView.window) [textView showFindIndicatorForRange:matches[index]];
  return {matches.size(), index + 1};
}

BOOL SparkTextShowFindBar(NSTextView *textView)
{
  if (!textView.usesFindBar || !textView.enclosingScrollView) return NO;
  [textView.window makeFirstResponder:textView];
  NSMenuItem *sender = [NSMenuItem new];
  sender.tag = NSTextFinderActionShowFindInterface;
  [textView performTextFinderAction:sender];
  return textView.enclosingScrollView.findBarVisible;
}

void SparkTextLookUp(NSTextView *textView)
{
  // A zero-length range makes AppKit pick the word around the insertion point.
  [textView showDefinitionForAttributedString:nil range:textView.selectedRange options:nil baselineOriginProvider:nil];
}
