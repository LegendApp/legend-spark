#include <cassert>
static NSString *call(RNDesktopFileSystem *module, NSString *method, NSDictionary *args) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block NSString *code;
  [module perform:method args:args binary:NO resolve:^(id value) { dispatch_semaphore_signal(done); }
    reject:^(NSString *value, NSString *message, NSError *error) { code = value; dispatch_semaphore_signal(done); }];
  assert(dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  return code;
}
static void drain(RNDesktopFileSystem *module) {
  for (SparkRecursiveWatch *watch in module.recursiveWatches.allValues) FSEventStreamFlushSync(watch.stream);
  dispatch_sync(module.ioQueue, ^{});
  while (dispatch_semaphore_wait(changes, DISPATCH_TIME_NOW) == 0) {}
}
static void changed(RNDesktopFileSystem *module, NSString *path, const char *step) {
  for (SparkRecursiveWatch *watch in module.recursiveWatches.allValues) FSEventStreamFlushSync(watch.stream);
  if (dispatch_semaphore_wait(changes, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
    fprintf(stderr, "No invalidation after %s\n", step); exit(1);
  }
  assert([lastPath isEqual:path]);
}
int main(int argc, const char **argv) { @autoreleasepool {
  changes = dispatch_semaphore_create(0);
  RNDesktopFileSystem *module = [RNDesktopFileSystem new];
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *root = [@(argv[1]) stringByAppendingPathComponent:@"missing/nested/library"];
  NSDictionary *args = @{ @"path": root, @"id": @"missing", @"recursive": @YES };
  assert(!call(module, @"watch", args));
  assert([call(module, @"watch", args) isEqual:@"E_INVALID_ARGUMENT"]);
  assert(module.recursiveWatches.count == 1);
  drain(module);
  assert([fm createDirectoryAtPath:root withIntermediateDirectories:YES attributes:nil error:nil]);
  changed(module, root, "creating missing root"); drain(module);
  NSString *child = [root stringByAppendingPathComponent:@"child"];
  assert([fm createDirectoryAtPath:child withIntermediateDirectories:NO attributes:nil error:nil]);
  changed(module, root, "creating child directory"); drain(module);
  NSString *file = [child stringByAppendingPathComponent:@"song.txt"];
  assert([@"hello" writeToFile:file atomically:YES encoding:NSUTF8StringEncoding error:nil]);
  changed(module, root, "writing nested file"); drain(module);
  assert([fm removeItemAtPath:root error:nil]);
  changed(module, root, "deleting root"); drain(module);
  assert([fm createDirectoryAtPath:root withIntermediateDirectories:YES attributes:nil error:nil]);
  changed(module, root, "recreating root"); drain(module);
  assert(!call(module, @"unwatch", @{ @"id": @"missing" }));
  assert(module.recursiveWatches.count == 0);
  assert([@"bye" writeToFile:[root stringByAppendingPathComponent:@"after.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil]);
  assert(dispatch_semaphore_wait(changes, dispatch_time(DISPATCH_TIME_NOW, 200 * NSEC_PER_MSEC)) != 0);
  NSString *regularFile = [root stringByAppendingPathComponent:@"after.txt"];
  for (NSString *path in @[regularFile, [regularFile stringByAppendingPathComponent:@"child"], [regularFile stringByAppendingPathComponent:@"missing/nested"]]) {
    assert([call(module, @"watch", @{ @"path": path, @"id": @"file", @"recursive": @YES }) isEqual:@"E_NOT_FOUND"]);
    assert(module.recursiveWatches.count == 0);
  }
  assert(!call(module, @"watch", @{ @"path": root, @"id": @"existing", @"recursive": @YES }));
  drain(module);
  assert([fm removeItemAtPath:root error:nil]); changed(module, root, "deleting existing watched root");
  [module invalidate]; dispatch_sync(module.ioQueue, ^{});
  assert(module.recursiveWatches.count == 0);
  puts("Recursive watches passed");
} }
