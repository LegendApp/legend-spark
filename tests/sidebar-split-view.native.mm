// Fabric boundary shim; all component implementation below is loaded from the reviewed source.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <CoreImage/CoreImage.h>
#import <objc/runtime.h>
#import <TargetConditionals.h>
#include <cassert>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
struct Props {using Shared=std::shared_ptr<const Props>;virtual ~Props()=default;};
struct SidebarSplitViewProps:Props {
 std::string appearance="system",contentTitlebarMaterial="none",contentTitlebarOverlayColor,sidebarTitlebarOverlayColor;
 double sidebarWidth=180,sidebarMinWidth=180,contentMinWidth=320,listWidth=240,listMinWidth=240,contentTitlebarHeight=0,contentTitlebarOverlayOpacity=0,sidebarTitlebarOverlayOpacity=0;
 bool hasList=false,sidebarCollapsed=false;
};
struct EventEmitter {using Shared=std::shared_ptr<const EventEmitter>;virtual ~EventEmitter()=default;};
struct ViewEventEmitter:EventEmitter {};
using Float=float;
struct Point {Float x=0,y=0;bool operator==(const Point&)const=default;};
struct Size {Float width=0,height=0;bool operator==(const Size&)const=default;};
struct Rect {Point origin;Size size;bool operator==(const Rect&)const=default;};
struct Insets {Float top=0,left=0,bottom=0,right=0;bool operator==(const Insets&)const=default;};
struct LayoutMetrics {Rect frame;Insets contentInsets,borderWidth,overflowInset;bool operator==(const LayoutMetrics&)const=default;};
static LayoutMetrics EmptyLayoutMetrics{};
using ComponentDescriptorProvider=int;
struct SidebarSplitViewComponentDescriptor {};
template<class T>int concreteComponentDescriptorProvider(){return 0;}
}
namespace facebook::react {
class SidebarSplitViewEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  struct OnSidebarCollapsedChange {
      bool collapsed;
    };

  struct OnSplitViewDidResize {
      double contentHeight;
    double contentWidth;
    double contentX;
    double height;
    bool isLayoutReady;
    bool isVertical;
    double listHeight;
    double listWidth;
    double listX;
    double sidebarHeight;
    double sidebarWidth;
    };
  void onSidebarCollapsedChange(OnSidebarCollapsedChange value) const;

  void onSplitViewDidResize(OnSplitViewDidResize value) const;
};
}

using namespace facebook::react;
static std::vector<bool> changes;
static std::vector<SidebarSplitViewEventEmitter::OnSplitViewDidResize> resizes;
void SidebarSplitViewEventEmitter::onSidebarCollapsedChange(OnSidebarCollapsedChange e)const{changes.push_back(e.collapsed);}
void SidebarSplitViewEventEmitter::onSplitViewDidResize(OnSplitViewDidResize e)const{resizes.push_back(e);}
@protocol RCTSidebarSplitViewViewProtocol @end
@protocol RCTComponentViewProtocol @end
static int RNComponentViewUpdateMaskLayoutMetrics=1;
@interface RCTViewComponentView:NSView<RCTComponentViewProtocol>{
 @public Props::Shared _props;EventEmitter::Shared _eventEmitter;
}
- (void)updateProps:(Props::Shared const&)p oldProps:(Props::Shared const&)old;
- (void)updateEventEmitter:(EventEmitter::Shared const&)emitter;
- (void)updateLayoutMetrics:(const LayoutMetrics&)m oldLayoutMetrics:(const LayoutMetrics&)old;
- (void)finalizeUpdates:(int)mask;
- (void)setBackgroundColor:(NSColor*)color;
- (void)mountChildComponentView:(RCTViewComponentView*)child index:(NSInteger)i;
- (void)unmountChildComponentView:(RCTViewComponentView*)child index:(NSInteger)i;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const&)p oldProps:(Props::Shared const&)old{_props=p;}
- (void)updateEventEmitter:(EventEmitter::Shared const&)e{_eventEmitter=e;}
- (void)updateLayoutMetrics:(const LayoutMetrics&)m oldLayoutMetrics:(const LayoutMetrics&)old{self.frame=NSMakeRect(m.frame.origin.x,m.frame.origin.y,m.frame.size.width,m.frame.size.height);}
- (void)finalizeUpdates:(int)mask{}
- (void)setBackgroundColor:(NSColor*)color{}
- (void)mountChildComponentView:(RCTViewComponentView*)c index:(NSInteger)i{}
- (void)unmountChildComponentView:(RCTViewComponentView*)c index:(NSInteger)i{}
- (void)layoutSubviews{}
- (void)prepareForRecycle{_eventEmitter.reset();}
@end
#define RCTUIView RCTViewComponentView
@interface RNSidebarSplitViewComponent:RCTViewComponentView @end

// ACTUAL_IMPLEMENTATION

static void spin(){NSDate *until=[NSDate dateWithTimeIntervalSinceNow:0.06];while(until.timeIntervalSinceNow>0)[[NSRunLoop currentRunLoop]runMode:NSDefaultRunLoopMode beforeDate:until];}
int main(){@autoreleasepool{
 [NSApplication sharedApplication];
 RNSidebarSplitViewComponent *v=[[RNSidebarSplitViewComponent alloc]initWithFrame:NSMakeRect(0,0,1000,600)];
 NSWindow *w=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,1000,600) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];w.contentView=v;
 [v updateEventEmitter:std::make_shared<SidebarSplitViewEventEmitter>()];
 auto props=std::make_shared<SidebarSplitViewProps>();[v updateProps:props oldProps:v->_props];
 RCTViewComponentView *sidebar=[RCTViewComponentView new],*content=[RCTViewComponentView new],*list=[RCTViewComponentView new];
 [v mountChildComponentView:sidebar index:0];[v mountChildComponentView:content index:1];
 [v layout];spin();
 NSSplitViewController *controller=[v valueForKey:@"splitViewController"];
 [controller.splitView setPosition:260 ofDividerAtIndex:0];[v layout];spin();
 // Direct AppKit transitions avoid an unfinished toggleSidebar animation in this hidden-window fixture.
 auto checkCollapsed=[&](bool expected){ assert(controller.splitViewItems[0].collapsed==expected); assert(!resizes.empty()); assert((resizes.back().sidebarWidth==0)==expected); assert(sidebar.hidden==expected); assert((sidebar.frame.size.width==0)==expected); };
 controller.splitViewItems[0].collapsed=!controller.splitViewItems[0].collapsed;spin();[v layout];checkCollapsed(true);assert(changes==std::vector<bool>{true});
 [v updateProps:props oldProps:props];[v layout];spin();checkCollapsed(true);assert(changes.size()==1);

 [v unmountChildComponentView:sidebar index:0];sidebar=[RCTViewComponentView new];
 [v mountChildComponentView:sidebar index:0];
 assert(sidebar.hidden && sidebar.frame.size.width==0);
 spin();checkCollapsed(true);
 puts("PASS full component collapsed child replacement has zero width immediately");

 auto echoed=std::make_shared<SidebarSplitViewProps>(*props);echoed->sidebarCollapsed=true;
 [v updateProps:echoed oldProps:props];spin();checkCollapsed(true);assert(changes.size()==1);
 controller.splitViewItems[0].collapsed=!controller.splitViewItems[0].collapsed;spin();[v layout];checkCollapsed(false);assert(changes==std::vector<bool>({true,false}));
 [v updateProps:echoed oldProps:echoed];[v layout];spin();checkCollapsed(false);

 double restored=resizes.back().sidebarWidth;
 auto expandEcho=std::make_shared<SidebarSplitViewProps>(*echoed);expandEcho->sidebarCollapsed=false;
 [v updateProps:expandEcho oldProps:echoed];spin();
 printf("Expanded sidebar width before echo=%.1f after echo=%.1f\n",restored,resizes.back().sidebarWidth);
 assert(fabs(restored-resizes.back().sidebarWidth)<0.5);
 echoed=expandEcho;
 puts("PASS full component controlled echo preserves user divider width");

 auto withList=std::make_shared<SidebarSplitViewProps>(*echoed);withList->hasList=true;
 [v updateProps:withList oldProps:echoed];[v mountChildComponentView:list index:2];spin();

 [controller.splitView setPosition:260 ofDividerAtIndex:0];
 [controller.splitView setPosition:601 ofDividerAtIndex:1];[v layout];spin();
 controller.splitViewItems[0].collapsed=!controller.splitViewItems[0].collapsed;spin();[v layout];checkCollapsed(true);assert(resizes.back().listWidth>0);printf("Collapsed list origin=%.1f\n",resizes.back().listX);
 double draggedList=resizes.back().listWidth;
 auto listEcho=std::make_shared<SidebarSplitViewProps>(*withList);listEcho->sidebarCollapsed=true;
 [v updateProps:listEcho oldProps:withList];spin();
 printf("Collapsed list width before echo=%.1f after echo=%.1f\n",draggedList,resizes.back().listWidth);
 assert(fabs(draggedList-resizes.back().listWidth)<0.5);

 puts("PASS full three-pane collapse echo preserves dragged list width");

 // A prop arriving before native observation owns the state and must not report a native change.
 size_t eventCount=changes.size();
 [v setValue:@YES forKey:@"layingOutSplitView"];
 controller.splitViewItems[0].collapsed=false;
 [v setValue:@NO forKey:@"layingOutSplitView"];
 auto winning=std::make_shared<SidebarSplitViewProps>(*listEcho);winning->sidebarCollapsed=false;
 [v updateProps:winning oldProps:listEcho];spin();checkCollapsed(false);assert(changes.size()==eventCount);
 // Exercise synchronous split-view changes in the same prop commit, with the observer installed.
 auto current=winning;
 for(int i=0;i<4;i++) {
   auto next=std::make_shared<SidebarSplitViewProps>(*current);
   next->hasList=!current->hasList;next->sidebarCollapsed=!current->sidebarCollapsed;
   [v updateProps:next oldProps:current];spin();
   assert(controller.splitViewItems[0].collapsed==next->sidebarCollapsed);assert(changes.size()==eventCount);
   current=next;
 }
 puts("PASS full component changed props win before observation and alongside list insertion/removal");
 [v prepareForRecycle];spin();assert(!controller.splitViewItems[0].collapsed);
 changes.clear();resizes.clear();[v updateEventEmitter:std::make_shared<SidebarSplitViewEventEmitter>()];
 auto fresh=std::make_shared<SidebarSplitViewProps>();[v updateProps:fresh oldProps:v->_props];
 [v mountChildComponentView:sidebar index:0];[v mountChildComponentView:content index:1];[v layout];spin();checkCollapsed(false);assert(changes.empty());
 controller.splitViewItems[0].collapsed=!controller.splitViewItems[0].collapsed;spin();[v layout];checkCollapsed(true);assert(changes==std::vector<bool>{true});
 puts("PASS full component recycle resets prop/native state and next lifetime emits once");
 puts("Full source AppKit component probe passed (generated event declarations; Fabric superclass shim)");
}}
