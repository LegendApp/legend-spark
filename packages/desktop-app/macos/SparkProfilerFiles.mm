#import "SparkProfilerFiles.h"
#if RCT_DEV
#include <vector>

NSString *const SparkProfilerMarker = @"spark-profiler";

dispatch_queue_t SparkProfilerQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("so.legend.spark.profiler", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0)); });
  return queue;
}

NSString *SparkProfilerDirectoryProblem(NSString *directory) {
  BOOL isDirectory = NO;
  if (!directory || ([directory isAbsolutePath] && [NSFileManager.defaultManager fileExistsAtPath:directory isDirectory:&isDirectory] && isDirectory)) return nil;
  return [NSString stringWithFormat:@"%@ is not an existing directory", directory];
}

static NSString *SparkJSONString(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

void SparkProfilerWrite(NSString *json, SparkProfilerCompletion completion) {
  NSString *argsCopy = [json copy];
  dispatch_async(SparkProfilerQueue(), ^{
    NSData *data = [argsCopy dataUsingEncoding:NSUTF8StringEncoding];
    id args = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSArray *files = [args isKindOfClass:NSDictionary.class] ? args[@"files"] : nil;
    id directory = [args isKindOfClass:NSDictionary.class] ? args[@"directory"] : nil;
    if (![files isKindOfClass:NSArray.class] || !files.count || (directory && ![directory isKindOfClass:NSString.class])) {
      completion(nil, @"E_INVALID_ARGUMENT", @"Expected {directory?, files}"); return;
    }
    NSRegularExpression *names = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$" options:0 error:nil];
    for (NSDictionary *file in files) {
      NSString *name = [file isKindOfClass:NSDictionary.class] ? file[@"name"] : nil;
      if (![name isKindOfClass:NSString.class] || ![names firstMatchInString:name options:0 range:NSMakeRange(0, name.length)] || ![file[@"contents"] isKindOfClass:NSString.class]) {
        completion(nil, @"E_INVALID_ARGUMENT", @"Expected files as {name, contents} with plain file names"); return;
      }
    }
    if ([[NSSet setWithArray:[files valueForKey:@"name"]] count] != files.count) { completion(nil, @"E_INVALID_ARGUMENT", @"Expected distinct file names"); return; }
    if (NSString *problem = SparkProfilerDirectoryProblem(directory)) { completion(nil, @"E_NOT_FOUND", problem); return; }
    NSString *target = directory;
    if (!target) {
      NSString *pattern = [NSTemporaryDirectory() stringByAppendingPathComponent:[SparkProfilerMarker stringByAppendingString:@"-XXXXXX"]];
      // fileSystemRepresentation returns a new buffer on each call: read it once.
      const char *representation = pattern.fileSystemRepresentation;
      std::vector<char> path(representation, representation + strlen(representation) + 1);
      if (!mkdtemp(path.data())) { completion(nil, @"E_NATIVE", [NSString stringWithFormat:@"Could not create a temporary directory: %s", strerror(errno)]); return; }
      target = [NSFileManager.defaultManager stringWithFileSystemRepresentation:path.data() length:strlen(path.data())];
    }
    NSMutableArray<NSString *> *paths = [NSMutableArray new];
    for (NSDictionary *file in files) [paths addObject:[target stringByAppendingPathComponent:file[@"name"]]];
    // Checked for every file first, so a name that is taken writes nothing.
    for (NSString *path in paths) if ([NSFileManager.defaultManager fileExistsAtPath:path]) { completion(nil, @"E_ALREADY_EXISTS", [NSString stringWithFormat:@"%@ already exists", path]); return; }
    for (NSUInteger index = 0; index < files.count; index++) {
      NSError *error;
      if (![[files[index][@"contents"] dataUsingEncoding:NSUTF8StringEncoding] writeToFile:paths[index] options:NSDataWritingWithoutOverwriting error:&error]) {
        BOOL exists = [error.domain isEqual:NSCocoaErrorDomain] && error.code == NSFileWriteFileExistsError;
        completion(nil, exists ? @"E_ALREADY_EXISTS" : @"E_NATIVE", [NSString stringWithFormat:@"Could not write %@: %@", paths[index], error.localizedDescription]);
        return;
      }
    }
    completion(SparkJSONString(@{ @"directory": target, @"paths": paths }), nil, nil);
  });
}
#endif
