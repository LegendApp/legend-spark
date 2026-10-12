// SparkProfilerWrite (packages/desktop-app/macos/SparkProfilerFiles.mm), compiled and run by tests/profiler-files-native.test.ts.
#import <Foundation/Foundation.h>
#import "SparkProfilerFiles.h"
#include <cstdio>

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)

struct Outcome { NSDictionary *value; NSString *code; NSString *message; BOOL onMain; };
/** Writes and waits for the completion, which must come off the main thread. */
static Outcome Write(id args) {
  NSString *json = [args isKindOfClass:NSString.class] ? args : [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:args options:0 error:nil] encoding:NSUTF8StringEncoding];
  __block Outcome outcome = {};
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  SparkProfilerWrite(json, ^(NSString *result, NSString *code, NSString *message) {
    outcome.onMain = NSThread.isMainThread;
    outcome.value = result ? [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
    outcome.code = code; outcome.message = message;
    dispatch_semaphore_signal(done);
  });
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  return outcome;
}
static NSString *Read(NSString *path) { return [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil]; }

int main(int argc, char **argv) { @autoreleasepool {
  NSString *root = @(argv[1]);
  NSFileManager *files = NSFileManager.defaultManager;
  NSArray *two = @[@{ @"name": @"spark-profiler-1.trace.json", @"contents": @"{\"traceEvents\":[]}" }, @{ @"name": @"spark-profiler-1-shared.cpuprofile", @"contents": @"é" }];

  // Into an existing directory: every file, in order, with its contents, off the main thread.
  Outcome written = Write(@{ @"directory": root, @"files": two });
  CHECK(!written.code && !written.onMain);
  CHECK([written.value[@"directory"] isEqual:root]);
  CHECK([written.value[@"paths"] isEqual:(@[[root stringByAppendingPathComponent:@"spark-profiler-1.trace.json"], [root stringByAppendingPathComponent:@"spark-profiler-1-shared.cpuprofile"]])]);
  CHECK([Read(written.value[@"paths"][1]) isEqual:@"é"]);

  // Never replaces a file, and writes none of a set when one name is taken.
  NSArray *again = @[@{ @"name": @"spark-profiler-2.trace.json", @"contents": @"new" }, @{ @"name": @"spark-profiler-1-shared.cpuprofile", @"contents": @"new" }];
  Outcome taken = Write(@{ @"directory": root, @"files": again });
  CHECK([taken.code isEqual:@"E_ALREADY_EXISTS"]);
  CHECK([Read([root stringByAppendingPathComponent:@"spark-profiler-1-shared.cpuprofile"]) isEqual:@"é"]);
  CHECK(![files fileExistsAtPath:[root stringByAppendingPathComponent:@"spark-profiler-2.trace.json"]]);

  // Only plain file names: no separators, no leading dot, no parent, at most 200 characters, distinct.
  NSString *longName = [@"" stringByPaddingToLength:201 withString:@"a" startingAtIndex:0];
  for (NSString *name in @[@"../escape", @"a/b", @".hidden", @"", @"..", @"spaced name", @"semi;colon", longName]) {
    Outcome rejected = Write(@{ @"directory": root, @"files": @[@{ @"name": name, @"contents": @"x" }] });
    CHECK([rejected.code isEqual:@"E_INVALID_ARGUMENT"]);
  }
  CHECK(!Write(@{ @"directory": root, @"files": @[@{ @"name": [longName substringFromIndex:1], @"contents": @"x" }] }).code);
  CHECK([Write(@{ @"directory": root, @"files": @[@{ @"name": @"twin", @"contents": @"1" }, @{ @"name": @"twin", @"contents": @"2" }] }).code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![files fileExistsAtPath:[root stringByAppendingPathComponent:@"twin"]]);
  CHECK(![files fileExistsAtPath:[root.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"escape"]]);

  // Malformed requests.
  for (id args in @[@"not json", @"[]", @{ @"files": @[] }, @{ @"files": @"x" }, @{ @"directory": @1, @"files": two }, @{ @"files": @[@{ @"name": @"a", @"contents": @1 }] }])
    CHECK([Write(args).code isEqual:@"E_INVALID_ARGUMENT"]);

  // Directories: relative paths and missing directories are not created.
  CHECK([Write(@{ @"directory": @"relative", @"files": two }).code isEqual:@"E_NOT_FOUND"]);
  CHECK([Write(@{ @"directory": [root stringByAppendingPathComponent:@"absent"], @"files": two }).code isEqual:@"E_NOT_FOUND"]);
  CHECK(![files fileExistsAtPath:[root stringByAppendingPathComponent:@"absent"]]);
  CHECK([Write(@{ @"directory": written.value[@"paths"][0], @"files": two }).code isEqual:@"E_NOT_FOUND"]);  // a file, not a directory

  // Without a directory: a new one in the temporary directory, named for the marker.
  Outcome temporary = Write(@{ @"files": two });
  NSString *created = temporary.value[@"directory"];
  CHECK(!temporary.code && [created.stringByDeletingLastPathComponent isEqual:NSTemporaryDirectory().stringByStandardizingPath] && [created.lastPathComponent hasPrefix:@"spark-profiler-"]);
  CHECK([[files contentsOfDirectoryAtPath:created error:nil] count] == 2);
  Outcome second = Write(@{ @"files": two });
  CHECK(!second.code && ![second.value[@"directory"] isEqual:created]);
  [files removeItemAtPath:created error:nil];
  [files removeItemAtPath:second.value[@"directory"] error:nil];

  if (failures) return 1;
  std::puts("Profiler files tests passed");
} return 0; }
