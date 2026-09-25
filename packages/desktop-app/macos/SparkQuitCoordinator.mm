#import "SparkQuitCoordinator.h"
@implementation SparkQuitCoordinator {
  NSMutableDictionary<NSString *, SparkQuitHandler> *_handlers;
  NSMutableSet<NSString *> *_pending;
  SparkQuitReply _reply;
  NSTimeInterval _timeout;
  NSUInteger _generation;
}
- (instancetype)initWithReply:(SparkQuitReply)reply timeout:(NSTimeInterval)timeout {
  if ((self = [super init])) { _handlers = [NSMutableDictionary new]; _reply = [reply copy]; _timeout = timeout; }
  return self;
}
- (void)finish:(BOOL)allow generation:(NSUInteger)generation {
  if (!_pending || _generation != generation) return;
  _pending = nil; _reply(allow);
}
- (void)registerHandler:(NSString *)identifier handler:(SparkQuitHandler)handler {
  NSAssert(NSThread.isMainThread, @"Quit handlers are main-thread confined");
  if (_handlers[identifier]) [self removeHandler:identifier];
  _handlers[identifier] = [handler copy];
  [NSProcessInfo.processInfo disableSuddenTermination];
  // A newly installed guard has not approved the current attempt.
  [self finish:NO generation:_generation];
}
- (void)removeHandler:(NSString *)identifier {
  NSAssert(NSThread.isMainThread, @"Quit handlers are main-thread confined");
  if (!_handlers[identifier]) return;
  [_handlers removeObjectForKey:identifier];
  [NSProcessInfo.processInfo enableSuddenTermination];
  [self finish:NO generation:_generation];
}
- (NSApplicationTerminateReply)requestQuit {
  NSAssert(NSThread.isMainThread, @"Quit requests are main-thread confined");
  if (_pending) return NSTerminateLater;
  if (!_handlers.count) return NSTerminateNow;
  NSDictionary<NSString *, SparkQuitHandler> *handlers = [_handlers copy];
  _pending = [NSMutableSet setWithArray:handlers.allKeys];
  NSUInteger generation = ++_generation;
  // Return Later before invoking even synchronous native handlers.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_pending || self->_generation != generation) return;
    for (NSString *identifier in handlers) {
      if (!self->_pending || self->_generation != generation) break;
      handlers[identifier](^(BOOL allow) {
        NSAssert(NSThread.isMainThread, @"Quit replies are main-thread confined");
        if (self->_generation != generation || ![self->_pending containsObject:identifier]) return;
        if (!allow) { [self finish:NO generation:generation]; return; }
        [self->_pending removeObject:identifier];
        if (!self->_pending.count) [self finish:YES generation:generation];
      });
    }
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(_timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self finish:NO generation:generation];
  });
  return NSTerminateLater;
}
- (void)dealloc {
  for (__unused NSString *identifier in _handlers) [NSProcessInfo.processInfo enableSuddenTermination];
}
@end
