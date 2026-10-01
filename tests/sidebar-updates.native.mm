#import <AppKit/AppKit.h>
#include <cassert>
#include <memory>
#include <string>
#define TARGET_OS_OSX 1
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
struct SidebarProps : Props {
  std::string itemsJson, selectedId;
  int selectionRevision = 0;
  double contentInsetTop = 0, defaultRowHeight = 28;
};
}
using namespace facebook::react;
@interface FixtureScroll : NSObject
@property NSEdgeInsets contentInsets;
@end
@implementation FixtureScroll @end
@interface FixtureView : NSObject
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
@end
@implementation FixtureView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {}
@end
@interface RNSidebar : FixtureView {
  double _contentInsetTop, _defaultRowHeight;
  NSArray *_dataItems;
  NSString *_selectedId;
  FixtureScroll *_scrollView;
}
@property int parses, reloads, selections, layouts;
@end
@implementation RNSidebar
- (instancetype)init { if (self = [super init]) _scrollView = [FixtureScroll new]; return self; }
- (NSArray *)itemsFromJson:(std::string const &)json { self.parses++; return @[]; }
- (void)reloadRows { self.reloads++; [self updateSelection]; }
- (void)updateSelection { self.selections++; }
- (void)setNeedsLayout:(BOOL)value { if (value) self.layouts++; }
// ACTUAL_UPDATE_PROPS
@end
int main() { @autoreleasepool {
  RNSidebar *view = [RNSidebar new];
  Props::Shared initial = std::make_shared<SidebarProps>();
  auto rows = std::make_shared<SidebarProps>(); rows->itemsJson = "[{\"id\":\"one\"}]"; rows->selectedId = "one";
  [view updateProps:rows oldProps:initial]; assert(view.parses == 1 && view.reloads == 1 && view.selections == 1);
  auto selection = std::make_shared<SidebarProps>(*rows); selection->selectedId = "";
  [view updateProps:selection oldProps:rows]; assert(view.parses == 1 && view.reloads == 1 && view.selections == 2);
  auto acknowledgement = std::make_shared<SidebarProps>(*selection); acknowledgement->selectionRevision = 1;
  [view updateProps:acknowledgement oldProps:selection]; assert(view.parses == 1 && view.reloads == 1 && view.selections == 3);
  auto inset = std::make_shared<SidebarProps>(*acknowledgement); inset->contentInsetTop = 10;
  [view updateProps:inset oldProps:acknowledgement]; assert(view.parses == 1 && view.reloads == 1 && view.selections == 3 && view.layouts == 1);
  auto height = std::make_shared<SidebarProps>(*inset); height->defaultRowHeight = 42;
  [view updateProps:height oldProps:inset]; assert(view.parses == 1 && view.reloads == 2 && view.selections == 4);
  auto changedRows = std::make_shared<SidebarProps>(*height); changedRows->itemsJson = "[]";
  [view updateProps:changedRows oldProps:height]; assert(view.parses == 2 && view.reloads == 3);
  puts("Sidebar selective updates passed");
} }
