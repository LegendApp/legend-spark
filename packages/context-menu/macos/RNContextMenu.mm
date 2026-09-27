#import "RNContextMenu.h"

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>

#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#endif

@interface RNContextMenu ()
#if TARGET_OS_OSX
<NSMenuDelegate>
#endif
@property (nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property (nonatomic, strong) id activeMenu;
@property (nonatomic, assign) BOOL didResolveSelection;
@end

@implementation RNContextMenu

RCT_EXPORT_MODULE(NativeContextMenu)

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeContextMenuSpecJSI>(params);
}

- (id)parseJSON:(NSString *)json fallback:(id)fallback
{
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) {
    return fallback;
  }

  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return value ?: fallback;
}

- (void)showMenu:(NSString *)itemsJson
    locationJson:(NSString *)locationJson
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  RCTExecuteOnMainQueue(^{
    NSArray *items = [self parseJSON:itemsJson fallback:@[]];
    NSDictionary *location = [self parseJSON:locationJson fallback:@{}];
    NSString *windowId = [location[@"windowId"] isKindOfClass:NSString.class] ? location[@"windowId"] : @"";
    NSWindow *window = nil;
    NSString *identifier = [@"spark." stringByAppendingString:windowId];
    for (NSWindow *candidate in NSApp.windows) if ([candidate.identifier isEqual:identifier]) { window = candidate; break; }
    if (!window) for (NSWindow *candidate in NSApp.windows) if ([candidate.identifier isEqual:windowId]) { window = candidate; break; }
    NSView *targetView = window.contentView;
    if (!targetView) { reject(@"E_NOT_FOUND", @"Context menu owner window does not exist", nil); return; }
    if (![items isKindOfClass:[NSArray class]] || items.count == 0) {
      resolve(@"");
      return;
    }

    if (self.pendingResolve) {
      reject(@"E_BUSY", @"A context menu is already open", nil);
      return;
    }

    self.pendingResolve = resolve;
    self.didResolveSelection = NO;

    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"ContextMenu"];
    menu.autoenablesItems = NO;
    menu.delegate = self;

    for (NSDictionary *itemConfig in items) {
      if (![itemConfig isKindOfClass:[NSDictionary class]]) {
        continue;
      }

      if ([itemConfig[@"separator"] boolValue]) { [menu addItem:NSMenuItem.separatorItem]; continue; }
      NSString *title = [itemConfig[@"title"] isKindOfClass:[NSString class]] ? itemConfig[@"title"] : @"";
      NSString *itemId = [itemConfig[@"id"] isKindOfClass:[NSString class]] ? itemConfig[@"id"] : title;
      BOOL enabled = itemConfig[@"enabled"] ? [itemConfig[@"enabled"] boolValue] : YES;
      NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(handleMenuItem:) keyEquivalent:@""];
      item.target = self;
      item.representedObject = itemId ?: @"";
      item.enabled = enabled;
      item.state = [itemConfig[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
      [menu addItem:item];
    }

    if (menu.numberOfItems == 0) {
      self.pendingResolve(@"");
      self.pendingResolve = nil;
      return;
    }

    double x = [location[@"x"] isKindOfClass:[NSNumber class]] ? [location[@"x"] doubleValue] : 0;
    double y = [location[@"y"] isKindOfClass:[NSNumber class]] ? [location[@"y"] doubleValue] : 0;
    NSPoint point = NSMakePoint(x, y);
    if (!targetView.isFlipped) {
      point.y = NSHeight(targetView.bounds) - point.y;
    }

    self.activeMenu = menu;
    // Tracking runs a nested event loop. Enter from the run loop, rather
    // than holding the main dispatch queue needed by other native calls.
    [NSRunLoop.mainRunLoop performBlock:^{
      if (self.activeMenu == menu) [menu popUpMenuPositioningItem:nil atLocation:point inView:targetView];
    }];
  });
#else
  resolve(@"");
#endif
}

#if TARGET_OS_OSX
- (void)invalidate
{
  RCTExecuteOnMainQueue(^{
    ((NSMenu *)self.activeMenu).delegate = nil;
    [(NSMenu *)self.activeMenu cancelTracking];
    if (self.pendingResolve) self.pendingResolve(@"");
    self.pendingResolve = nil; self.activeMenu = nil;
  });
}

- (void)handleMenuItem:(NSMenuItem *)sender
{
  if (!self.pendingResolve) {
    return;
  }

  self.didResolveSelection = YES;
  NSString *itemId = [sender.representedObject isKindOfClass:[NSString class]] ? sender.representedObject : @"";
  self.pendingResolve(itemId ?: @"");
  self.pendingResolve = nil;
  ((NSMenu *)self.activeMenu).delegate = nil;
  self.activeMenu = nil;
}

- (void)menuDidClose:(NSMenu *)menu
{
  if (menu != self.activeMenu) {
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self.didResolveSelection && self.pendingResolve) {
      self.pendingResolve(@"");
    }
    self.pendingResolve = nil;
    ((NSMenu *)self.activeMenu).delegate = nil;
    self.activeMenu = nil;
    self.didResolveSelection = NO;
  });
}
#endif

@end
