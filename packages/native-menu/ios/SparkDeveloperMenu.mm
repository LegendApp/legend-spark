#import "SparkDeveloperMenu.h"
#if RCT_DEV
#import <React/RCTBridgeModule.h>
#import <React/RCTBundleManager.h>
#import <React/RCTDevSettings.h>
#import <React/RCTReloadCommand.h>
#import <RNDesktopApp/SparkRuntimeHosts.h>
#import <RNDesktopApp/SparkProfiler.h>
#import <objc/message.h>

// An RCTHost (bridgeless); declared locally so this pod needs no React-RuntimeApple headers.
@protocol SparkDeveloperHost <NSObject>
@property (nonatomic, readonly) RCTModuleRegistry *moduleRegistry;
@end

static NSView *SparkDeveloperFind(NSView *view, BOOL (^match)(NSView *)) {
  if (match(view)) return view;
  for (NSView *child in view.subviews) {
    NSView *found = SparkDeveloperFind(child, match);
    if (found) return found;
  }
  return nil;
}

NSDictionary *SparkDeveloperTarget(NSWindow *window) {
  NSView *content = window.contentView;
  if (!content) return nil;
  // A navigator isolated window renders `<Threaded testID="spark-window-surface-<id>">` (desktop-windows root.tsx)
  // inside a shared-runtime root, so look for it before the shared surface that contains it.
  Class threaded = NSClassFromString(@"ThreadedRuntimeSurfaceView");
  NSView *isolated = threaded ? SparkDeveloperFind(content, ^BOOL(NSView *view) { return [view.accessibilityIdentifier hasPrefix:@"spark-window-surface-"]; }) : nil;
  NSView *surface = isolated ? SparkDeveloperFind(isolated, ^BOOL(NSView *view) { return [view isKindOfClass:threaded]; }) : nil;
  NSString *name = [surface valueForKey:@"runtimeName"];
  if (name.length) return @{ @"runtime": @"isolated", @"name": name };
  Class hosting = NSClassFromString(@"RCTSurfaceHostingView");
  return hosting && SparkDeveloperFind(content, ^BOOL(NSView *view) { return [view isKindOfClass:hosting]; }) ? @{ @"runtime": @"shared" } : nil;
}

static id<SparkDeveloperHost> SparkDeveloperHostFor(NSDictionary *target) {
  if ([target[@"runtime"] isEqual:@"shared"]) return SparkRuntimeHost(nil);
  return [target[@"runtime"] isEqual:@"isolated"] ? SparkRuntimeHost(target[@"name"]) : nil;
}

static RCTDevSettings *SparkDeveloperSettings(id<SparkDeveloperHost> host) {
  id settings = [host.moduleRegistry moduleForName:"DevSettings"];
  return [settings isKindOfClass:RCTDevSettings.class] ? settings : nil;
}

void SparkDeveloperConfigure(NSMenuItem *item, NSDictionary *instruction) {
  item.toolTip = instruction[@"toolTip"];
  // The hidden Show Developer Menu item exists only for its key equivalent.
  if ([instruction[@"action"] isEqual:@"showMenu"]) item.allowsKeyEquivalentWhenHidden = YES;
}

BOOL SparkDeveloperValidate(NSMenuItem *item, NSDictionary *instruction) {
  NSString *action = instruction[@"action"];
  if ([action isEqual:@"showMenu"]) return YES;
  // Reloading the shared runtime restarts every runtime: the host destroys isolated runtimes on reload.
  if ([action isEqual:@"reload"]) return SparkDeveloperHostFor(@{ @"runtime": @"shared" }) != nil;
  if ([action isEqual:@"openDevTools"] && ![instruction[@"available"] boolValue]) return NO;
  // Profiling records the whole app, whatever window is key, and not while React Native DevTools records.
  if ([action isEqual:@"startProfiling"]) return [instruction[@"available"] boolValue] && !SparkProfilerRecording() && !SparkProfilerDevToolsRecording();
  if ([action isEqual:@"stopProfiling"]) return SparkProfilerRecording();
  NSDictionary *target = SparkDeveloperTarget(NSApp.keyWindow);
  id<SparkDeveloperHost> host = target ? SparkDeveloperHostFor(target) : nil;
  if (!host) return NO;
  if ([action isEqual:@"togglePerfMonitor"]) return NSClassFromString(@"RCTPerfMonitor") != nil;
  RCTDevSettings *settings = SparkDeveloperSettings(host);
  if ([action isEqual:@"toggleFastRefresh"]) {
    item.state = settings.isHotLoadingEnabled ? NSControlStateValueOn : NSControlStateValueOff;
    return settings.isHotLoadingAvailable;
  }
  return settings != nil;
}

static void SparkDeveloperBundleInfo(NSDictionary *instruction, NSDictionary *target, RCTDevSettings *settings) {
  NSDictionary *labels = instruction[@"labels"], *runtimes = instruction[@"runtimes"];
  NSString *runtime = [target[@"runtime"] isEqual:@"isolated"] ? [runtimes[@"isolated"] stringByReplacingOccurrencesOfString:@"{name}" withString:target[@"name"]] : runtimes[@"shared"];
  NSMutableArray<NSString *> *lines = [NSMutableArray arrayWithObjects:
    [NSString stringWithFormat:@"%@: %@", labels[@"bundleURL"], settings.bundleManager.bundleURL.absoluteString ?: @"—"],
    [NSString stringWithFormat:@"%@: %@", labels[@"runtime"], runtime], nil];
  [lines addObjectsFromArray:instruction[@"lines"]];
  NSString *text = [lines componentsJoinedByString:@"\n"];
  NSAlert *alert = [NSAlert new];
  alert.messageText = instruction[@"title"];
  alert.informativeText = text;
  [alert addButtonWithTitle:instruction[@"ok"]];
  [alert addButtonWithTitle:instruction[@"copy"]];
  void (^done)(NSModalResponse) = ^(NSModalResponse response) {
    if (response != NSAlertSecondButtonReturn) return;
    [NSPasteboard.generalPasteboard clearContents];
    [NSPasteboard.generalPasteboard setString:text forType:NSPasteboardTypeString];
  };
  if (NSApp.keyWindow) [alert beginSheetModalForWindow:NSApp.keyWindow completionHandler:done];
  else done([alert runModal]);
}

void SparkDeveloperPerform(NSMenuItem *item, NSDictionary *instruction, SparkDeveloperEmit emit) {
  NSString *action = instruction[@"action"];
  if ([action isEqual:@"showMenu"]) {
    // A copy: the Developer submenu already belongs to the menu bar. After the key event finishes.
    NSMenu *menu = [item.menu copy];
    dispatch_async(dispatch_get_main_queue(), ^{ [menu popUpMenuPositioningItem:nil atLocation:NSEvent.mouseLocation inView:nil]; });
    return;
  }
  if ([action isEqual:@"reload"]) { RCTTriggerReloadCommandListeners(@"Spark Developer menu"); return; }
  if ([action isEqual:@"startProfiling"]) { emit(@{ @"action": action }); return; }
  if ([action isEqual:@"stopProfiling"]) {
    // The profile goes where the developer chooses; cancelling keeps recording.
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseDirectories = YES;
    panel.canChooseFiles = NO;
    panel.canCreateDirectories = YES;
    panel.prompt = instruction[@"prompt"];
    panel.message = instruction[@"message"];
    void (^chosen)(NSModalResponse) = ^(NSModalResponse response) {
      if (response == NSModalResponseOK && panel.URL.path) emit(@{ @"action": action, @"directory": panel.URL.path });
    };
    if (NSApp.keyWindow) [panel beginSheetModalForWindow:NSApp.keyWindow completionHandler:chosen];
    else chosen([panel runModal]);
    return;
  }
  // Validation enabled the item for the key window; it cannot change while the menu is open.
  NSDictionary *target = SparkDeveloperTarget(NSApp.keyWindow);
  id<SparkDeveloperHost> host = target ? SparkDeveloperHostFor(target) : nil;
  if (!host) return;
  if ([action isEqual:@"openDevTools"]) { emit(@{ @"action": action, @"target": target }); return; }
  RCTDevSettings *settings = SparkDeveloperSettings(host);
  if ([action isEqual:@"toggleInspector"]) [settings toggleElementInspector];
  else if ([action isEqual:@"toggleFastRefresh"]) settings.isHotLoadingEnabled = !settings.isHotLoadingEnabled;
  else if ([action isEqual:@"togglePerfMonitor"]) {
    // Each runtime's monitor measures that runtime; its own window says whether it is showing.
    id monitor = [host.moduleRegistry moduleForName:"PerfMonitor"];
    BOOL shown = [[monitor valueForKey:@"_containerWindow"] isVisible];
    SEL toggle = shown ? NSSelectorFromString(@"hide") : NSSelectorFromString(@"show");
    if (![monitor respondsToSelector:toggle]) return;
    ((void (*)(id, SEL))objc_msgSend)(monitor, toggle);
    settings.isPerfMonitorShown = !shown;
  }
  else if ([action isEqual:@"bundleInfo"]) SparkDeveloperBundleInfo(instruction, target, settings);
}
#endif
