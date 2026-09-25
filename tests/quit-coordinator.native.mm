#import "SparkQuitCoordinator.h"
static void pump(double seconds = 0.02) { [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main() { @autoreleasepool {
  __block NSMutableArray<NSNumber *> *replies = [NSMutableArray new];
  SparkQuitCoordinator *quit = [[SparkQuitCoordinator alloc] initWithReply:^(BOOL allow) { [replies addObject:@(allow)]; } timeout:0.1];
  check([quit requestQuit] == NSTerminateNow, "No handlers must quit immediately");
  __block SparkQuitReply first, second;
  [quit registerHandler:@"first" handler:^(SparkQuitReply reply) { first = reply; }];
  [quit registerHandler:@"second" handler:^(SparkQuitReply reply) { second = reply; }];
  check([quit requestQuit] == NSTerminateLater, "Registered handlers must defer");
  check(!first, "Handlers must run after returning Later"); pump();
  first(YES); check(replies.count == 0, "One approval cannot bypass another guard");
  second(NO); check([replies.lastObject isEqual:@NO], "A refusal must cancel");
  SparkQuitReply stale = first;
  [quit requestQuit]; pump(); stale(YES);
  check(replies.count == 1, "Stale replies cannot finish a new attempt");
  first(YES); first(YES); check(replies.count == 1, "Duplicate replies cannot approve another guard");
  second(YES); check([replies.lastObject isEqual:@YES], "All approvals should quit");
  [quit requestQuit]; pump(); [quit removeHandler:@"second"];
  check([replies.lastObject isEqual:@NO], "Removing a guard during quit must cancel");
  [quit requestQuit]; pump(0.15); check([replies.lastObject isEqual:@NO], "Timeout must cancel");
  [quit removeHandler:@"first"]; check([quit requestQuit] == NSTerminateNow, "Removed guards cannot block quit");
  puts("Quit lifecycle tests passed");
} }
