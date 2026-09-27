#import "RNFileScannerCore.h"
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main(int argc, const char **argv) { @autoreleasepool {
  NSURL *root = [NSURL fileURLWithPath:@(argv[1]) isDirectory:YES];
  for (NSString *name in @[@"a.txt", @"b.txt", @"c.txt"]) check([@"text" writeToURL:[root URLByAppendingPathComponent:name] atomically:YES encoding:NSUTF8StringEncoding error:nil], "create file");
  RNFileScannerOptions *options = [RNFileScannerOptions new]; options.batchSize = 1; options.allowedExtensions = [NSSet setWithObject:@"txt"]; options.includeStats = YES;
  __block BOOL cancelled = NO; __block NSUInteger batches = 0;
  NSDictionary *result = RNFileScannerRun(@[root.path], options, nil,
    ^(NSArray *items, NSUInteger rootIndex, NSUInteger completed, NSUInteger total) {
      batches++; cancelled = YES; check(items.count == 1 && [items[0][@"size"] unsignedIntegerValue] == 4, "bounded batch and native stats");
    }, nil, ^BOOL { return cancelled; });
  check(batches == 1 && [result[@"totalFiles"] unsignedIntegerValue] == 1, "cancellation stops traversal between entries");
  result = RNFileScannerRun(@[root.path], options, nil, nil, nil, nil);
  check([result[@"totalFiles"] unsignedIntegerValue] == 3 && [result[@"errors"] count] == 0, "fresh scan completes independently");
  puts("File scanner tests passed");
} }
