#import "RNKeyboardManager.h"

#import <React/RCTBridgeModule.h>
#import <TargetConditionals.h>
#include <cmath>
#include <atomic>

#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#import <IOKit/hidsystem/IOLLEvent.h>
#import <IOKit/hidsystem/ev_keymap.h>
#endif

static NSInteger const RNKeyboardMediaPlayPause = 10001;
static NSInteger const RNKeyboardMediaNext = 10002;
static NSInteger const RNKeyboardMediaPrevious = 10003;

#if TARGET_OS_OSX
static NSUInteger const RNKeyboardModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift | NSEventModifierFlagFunction | NSEventModifierFlagCapsLock;
@interface SparkKeyboardRule : NSObject
@property (nonatomic, copy) NSString *key;
@property (nonatomic) NSUInteger modifiers;
@property (nonatomic) BOOL allowExtraModifiers;
@property (nonatomic) BOOL repeat;
@property (nonatomic, copy) NSSet<NSString *> *windowIds;
@property (nonatomic, copy) NSSet<NSString *> *excludedWindowIds;
@end
@implementation SparkKeyboardRule @end

static BOOL SparkKeyboardBoolean(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
static NSSet<NSString *> *SparkKeyboardWindows(id value, BOOL *valid) {
  if (!value) return nil;
  if (![value isKindOfClass:NSArray.class]) { *valid = NO; return nil; }
  for (id identifier in value) if (![identifier isKindOfClass:NSString.class] || ![identifier length]) { *valid = NO; return nil; }
  return [NSSet setWithArray:value];
}
#endif

@implementation RNKeyboardManager {
  std::atomic<bool> _hasListeners;
#if TARGET_OS_OSX
  id _localEventMonitor;
  NSMutableDictionary<NSString *, NSArray<SparkKeyboardRule *> *> *_consumptionOwners;
  NSMutableSet<NSString *> *_captureOwners;
  NSDictionary<NSString *, NSArray<SparkKeyboardRule *> *> *_rulesByKey;
  NSMutableDictionary<NSNumber *, NSNumber *> *_consumedKeys;
#endif
}

RCT_EXPORT_MODULE(NativeKeyboardManager)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  if (self = [super init]) {
    _hasListeners.store(false, std::memory_order_relaxed);
#if TARGET_OS_OSX
    _consumptionOwners = [NSMutableDictionary new];
    _captureOwners = [NSMutableSet new];
    _rulesByKey = @{};
    _consumedKeys = [NSMutableDictionary new];
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(applicationWillTerminate:)
                                               name:NSApplicationWillTerminateNotification
                                             object:nil];
#endif
  }
  return self;
}

- (void)dealloc
{
#if TARGET_OS_OSX
  id monitor = _localEventMonitor;
  if (monitor) {
    if (NSThread.isMainThread) [NSEvent removeMonitor:monitor];
    else dispatch_async(dispatch_get_main_queue(), ^{ [NSEvent removeMonitor:monitor]; });
  }
  [NSNotificationCenter.defaultCenter removeObserver:self];
#endif
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"onKeyDown", @"onKeyUp"];
}

- (void)startObserving
{
  _hasListeners.store(true, std::memory_order_relaxed);
}

- (void)stopObserving
{
  _hasListeners.store(false, std::memory_order_relaxed);
#if TARGET_OS_OSX
  if (NSThread.isMainThread) [self stopMonitoringInternal];
  else dispatch_async(dispatch_get_main_queue(), ^{ [self stopMonitoringInternal]; });
#endif
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeKeyboardManagerSpecJSI>(params);
}

- (void)startMonitoringKeyboard:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  dispatch_async(dispatch_get_main_queue(), ^{
    [self startMonitoringInternal];
    if (self->_localEventMonitor) resolve(@YES); else reject(@"E_UNAVAILABLE", @"Keyboard event monitor could not start", nil);
  });
#else
  reject(@"E_UNSUPPORTED_PLATFORM", @"Keyboard monitoring requires macOS", nil);
#endif
}

- (void)stopMonitoringKeyboard:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopMonitoringInternal];
    resolve(@YES);
  });
#else
  resolve(@NO);
#endif
}

- (void)setConsumption:(NSString *)ownerId rulesJson:(NSString *)rulesJson capture:(BOOL)capture resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
#if TARGET_OS_OSX
  id values = [NSJSONSerialization JSONObjectWithData:[rulesJson dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil];
  if (!ownerId.length || ![values isKindOfClass:NSArray.class]) { reject(@"E_INVALID_ARGUMENT", @"Expected an owner and keyboard consumption rules", nil); return; }
  NSMutableArray<SparkKeyboardRule *> *rules = [NSMutableArray new];
  for (id value in values) {
    if (![value isKindOfClass:NSDictionary.class]) { reject(@"E_INVALID_ARGUMENT", @"Invalid keyboard consumption rule", nil); return; }
    id key = value[@"key"], modifiers = value[@"modifiers"];
    BOOL valid = [key isKindOfClass:NSString.class] && [key length] && [modifiers isKindOfClass:NSNumber.class] && !SparkKeyboardBoolean(modifiers);
    double bits = valid ? [modifiers doubleValue] : -1;
    valid = valid && std::isfinite(bits) && bits >= 0 && bits <= RNKeyboardModifierMask && std::floor(bits) == bits && (((NSUInteger)bits & ~RNKeyboardModifierMask) == 0);
    valid = valid && SparkKeyboardBoolean(value[@"allowExtraModifiers"]) && SparkKeyboardBoolean(value[@"repeat"]);
    SparkKeyboardRule *rule = [SparkKeyboardRule new];
    rule.windowIds = SparkKeyboardWindows(value[@"windowIds"], &valid);
    rule.excludedWindowIds = SparkKeyboardWindows(value[@"excludedWindowIds"], &valid);
    if (!valid) { reject(@"E_INVALID_ARGUMENT", @"Invalid keyboard consumption rule", nil); return; }
    rule.key = [key lowercaseString]; rule.modifiers = (NSUInteger)bits;
    rule.allowExtraModifiers = [value[@"allowExtraModifiers"] boolValue]; rule.repeat = [value[@"repeat"] boolValue];
    [rules addObject:rule];
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (rules.count) self->_consumptionOwners[ownerId] = rules; else [self->_consumptionOwners removeObjectForKey:ownerId];
    if (capture) [self->_captureOwners addObject:ownerId]; else [self->_captureOwners removeObject:ownerId];
    NSMutableDictionary<NSString *, NSMutableArray<SparkKeyboardRule *> *> *byKey = [NSMutableDictionary new];
    for (NSArray<SparkKeyboardRule *> *ownerRules in self->_consumptionOwners.allValues) for (SparkKeyboardRule *rule in ownerRules) {
      if (!byKey[rule.key]) byKey[rule.key] = [NSMutableArray new];
      [byKey[rule.key] addObject:rule];
    }
    self->_rulesByKey = byKey;
    resolve(@YES);
  });
#else
  reject(@"E_UNSUPPORTED_PLATFORM", @"Keyboard consumption requires macOS", nil);
#endif
}

- (void)invalidate
{
  _hasListeners.store(false, std::memory_order_relaxed);
#if TARGET_OS_OSX
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopMonitoringInternal];
    [self->_consumptionOwners removeAllObjects]; [self->_captureOwners removeAllObjects]; self->_rulesByKey = @{};
  });
#endif
  [super invalidate];
}

#if TARGET_OS_OSX
- (void)applicationWillTerminate:(NSNotification *)notification
{
  [self stopMonitoringInternal];
}

- (void)startMonitoringInternal
{
  [self stopMonitoringInternal];
  __weak RNKeyboardManager *weakSelf = self;
  NSEventMask eventMask = NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskSystemDefined;
  _localEventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:eventMask handler:^NSEvent *(NSEvent *event) {
    RNKeyboardManager *strongSelf = weakSelf;
    if (!strongSelf) {
      return event;
    }
    return [strongSelf handleKeyboardEvent:event];
  }];
}

- (void)stopMonitoringInternal
{
  if (_localEventMonitor) {
    [NSEvent removeMonitor:_localEventMonitor];
    _localEventMonitor = nil;
  }
  [_consumedKeys removeAllObjects];
}

- (NSEvent *)handleKeyboardEvent:(NSEvent *)event
{
  if (event.type == NSEventTypeSystemDefined) {
    return [self handleSystemDefinedEvent:event];
  }

  if (event.type != NSEventTypeKeyDown && event.type != NSEventTypeKeyUp) {
    return event;
  }

  NSString *eventName = event.type == NSEventTypeKeyDown ? @"onKeyDown" : @"onKeyUp";
  BOOL handled = [self emitKeyboardEvent:eventName keyCode:event.keyCode key:[event charactersByApplyingModifiers:0].lowercaseString ?: @"" modifiers:event.modifierFlags window:event.window repeated:event.isARepeat];
  return handled ? nil : event;
}

- (NSEvent *)handleSystemDefinedEvent:(NSEvent *)event
{
  if (event.subtype != NX_SUBTYPE_AUX_CONTROL_BUTTONS) {
    return event;
  }
  NSInteger data = event.data1;
  NSInteger keyCode = (data & 0xFFFF0000) >> 16;
  NSInteger keyFlags = data & 0x0000FFFF;
  NSInteger keyState = (keyFlags & 0xFF00) >> 8;
  NSNumber *mappedKeyCode = [self mappedMediaKeyCode:keyCode];
  if (!mappedKeyCode) {
    return event;
  }
  NSString *eventName = keyState == NX_KEYDOWN ? @"onKeyDown" : @"onKeyUp";
  BOOL handled = [self emitKeyboardEvent:eventName keyCode:mappedKeyCode.integerValue key:@{@10001: @"MediaPlayPause", @10002: @"MediaNext", @10003: @"MediaPrevious"}[mappedKeyCode] modifiers:event.modifierFlags window:event.window repeated:(keyFlags & 1) != 0];
  return handled ? nil : event;
}

- (NSNumber *)mappedMediaKeyCode:(NSInteger)keyCode
{
  switch (keyCode) {
    case NX_KEYTYPE_PLAY:
      return @(RNKeyboardMediaPlayPause);
    case NX_KEYTYPE_FAST:
    case NX_KEYTYPE_NEXT:
      return @(RNKeyboardMediaNext);
    case NX_KEYTYPE_REWIND:
    case NX_KEYTYPE_PREVIOUS:
      return @(RNKeyboardMediaPrevious);
    default:
      return nil;
  }
}

- (BOOL)emitKeyboardEvent:(NSString *)eventName keyCode:(NSInteger)keyCode key:(NSString *)key modifiers:(NSUInteger)modifiers window:(NSWindow *)window repeated:(BOOL)repeated
{
  NSString *identifier = (window ?: NSApp.keyWindow).identifier;
  NSString *windowId = [identifier hasPrefix:@"spark."] ? [identifier substringFromIndex:6] : identifier;
  BOOL down = [eventName isEqual:@"onKeyDown"];
  NSNumber *held = _consumedKeys[@(keyCode)];
  BOOL captured = _captureOwners.count > 0 || (!down && held.boolValue);
  BOOL consumed = captured || (!down && held != nil);
  if (down && !consumed) {
    NSString *normalizedKey = key.lowercaseString;
    for (SparkKeyboardRule *rule in _rulesByKey[normalizedKey]) {
      if ((repeated && !rule.repeat) || (rule.windowIds && (!windowId || ![rule.windowIds containsObject:windowId])) || (windowId && [rule.excludedWindowIds containsObject:windowId])) continue;
      NSUInteger active = modifiers & RNKeyboardModifierMask;
      if (!(rule.modifiers & NSEventModifierFlagCapsLock)) active &= ~NSEventModifierFlagCapsLock;
      if (!(rule.modifiers & NSEventModifierFlagFunction) && key.length == 1 && [key characterAtIndex:0] >= 0xf700 && [key characterAtIndex:0] <= 0xf747) active &= ~NSEventModifierFlagFunction;
      if (rule.allowExtraModifiers ? (active & rule.modifiers) == rule.modifiers : active == rule.modifiers) { consumed = YES; break; }
    }
  }
  if (down && consumed) _consumedKeys[@(keyCode)] = @(captured || held.boolValue);
  if (!down) [_consumedKeys removeObjectForKey:@(keyCode)];
  if (_hasListeners.load(std::memory_order_relaxed)) [self sendEventWithName:eventName body:@{
    @"keyCode": @(keyCode), @"key": key, @"modifiers": @(modifiers), @"windowId": windowId ?: (id)NSNull.null,
    @"repeated": @(repeated), @"consumed": @(consumed), @"captured": @(captured),
  }];
  return consumed;
}
#endif

@end
