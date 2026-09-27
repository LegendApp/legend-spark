#import "RNFileScanner.h"
#import "RNFileScannerCore.h"
#import <React/RCTBridgeModule.h>

@interface SparkScanTask : NSObject
@property (atomic) BOOL cancelled;
@end
@implementation SparkScanTask
@end

@implementation RNFileScanner {
  BOOL _hasListeners;
  BOOL _invalidated;
  NSMutableDictionary<NSString *, SparkScanTask *> *_tasks;
}
RCT_EXPORT_MODULE(NativeFileScanner)
- (instancetype)init { if (self = [super init]) _tasks = [NSMutableDictionary new]; return self; }
- (NSArray<NSString *> *)supportedEvents { return @[@"onFileScanBatch", @"onFileScanProgress"]; }
- (void)startObserving { @synchronized(self) { _hasListeners = YES; } }
- (void)stopObserving { @synchronized(self) { _hasListeners = NO; } }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeFileScannerSpecJSI>(params);
}
- (RNFileScannerOptions *)scanOptionsFromJSON:(NSString *)optionsJson
{
  id rawValue = RNFileScannerJSONObjectFromString(optionsJson);
  NSDictionary *rawOptions = [rawValue isKindOfClass:NSDictionary.class] ? rawValue : @{};

  RNFileScannerOptions *options = [RNFileScannerOptions new];
  options.allowedExtensions = RNFileScannerExtensionsFromArray(rawOptions[@"allowedExtensions"], @[]);
  options.batchSize = [rawOptions[@"batchSize"] unsignedIntegerValue] ?: 64;
  options.includeHidden = [rawOptions[@"includeHidden"] boolValue];
  options.includeStats = [rawOptions[@"includeStats"] boolValue];
  options.skipLookup = RNFileScannerSkipLookupFromArray(rawOptions[@"skip"]);
  return options;
}


- (BOOL)canEmitForTask:(SparkScanTask *)task {
  @synchronized(self) { return _hasListeners && !_invalidated && !task.cancelled; }
}

- (void)scanFiles:(NSString *)identifier pathsJson:(NSString *)pathsJson optionsJson:(NSString *)optionsJson
          resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  SparkScanTask *task = [SparkScanTask new];
  @synchronized(self) {
    if (_invalidated) { reject(@"E_CLOSED", @"Scanner has shut down", nil); return; }
    if (_tasks[identifier]) { reject(@"E_BUSY", @"Duplicate scan ID", nil); return; }
    _tasks[identifier] = task;
  }
  NSArray *paths = RNFileScannerJSONObjectFromString(pathsJson);
  RNFileScannerOptions *options = [self scanOptionsFromJSON:optionsJson];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSDictionary *result = RNFileScannerRun(paths, options, nil,
      ^(NSArray<NSDictionary *> *items, NSUInteger rootIndex, NSUInteger completedRoots, NSUInteger totalRoots) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if ([self canEmitForTask:task]) [self sendEventWithName:@"onFileScanBatch" body:@{
            @"id": identifier, @"files": items, @"rootIndex": @(rootIndex), @"completedRoots": @(completedRoots), @"totalRoots": @(totalRoots)}];
        });
      },
      ^(NSUInteger rootIndex, NSUInteger completedRoots, NSUInteger totalRoots) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if ([self canEmitForTask:task]) [self sendEventWithName:@"onFileScanProgress" body:@{
            @"id": identifier, @"rootIndex": @(rootIndex), @"completedRoots": @(completedRoots), @"totalRoots": @(totalRoots)}];
        });
      }, ^BOOL { return task.cancelled; });
    dispatch_async(dispatch_get_main_queue(), ^{
      @synchronized(self) { [self->_tasks removeObjectForKey:identifier]; }
      if (task.cancelled) reject(@"E_ABORTED", @"File scan cancelled", nil);
      else resolve(RNFileScannerJSONString(result));
    });
  });
}
- (void)cancelScan:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  @synchronized(self) { _tasks[identifier].cancelled = YES; }
  resolve(nil);
}
- (void)invalidate {
  @synchronized(self) { _invalidated = YES; for (SparkScanTask *task in _tasks.allValues) task.cancelled = YES; }
  [super invalidate];
}
@end
