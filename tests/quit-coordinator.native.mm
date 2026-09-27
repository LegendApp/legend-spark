#import "SparkQuitCoordinator.h"
static void pump(double seconds = 0.02) { [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main() { @autoreleasepool {
  __block NSMutableArray<NSNumber *> *replies = [NSMutableArray new];
  SparkQuitCoordinator *quit = [[SparkQuitCoordinator alloc] initWithReply:^(BOOL allow) { [replies addObject:@(allow)]; } timeout:0.1];
  __block NSMutableArray<NSNumber *> *decisions = [NSMutableArray new];
  [quit observeDecision:^(BOOL allow) { [decisions addObject:@(allow)]; }];
  check([quit requestQuit] == NSTerminateNow, "No handlers must quit immediately");
  check([decisions.lastObject isEqual:@YES], "Immediate quit must resolve its observers");
  [decisions removeAllObjects];
  __block SparkQuitReply first, second;
  [quit registerHandler:@"first" handler:^(SparkQuitReply reply) { first = reply; }];
  [quit registerHandler:@"second" handler:^(SparkQuitReply reply) { second = reply; }];
  check([quit requestQuit] == NSTerminateLater, "Registered handlers must defer");
  check(!first, "Handlers must run after returning Later"); pump();
  [quit observeDecision:^(BOOL allow) { [decisions addObject:@(allow)]; }];
  [quit observeDecision:^(BOOL allow) { [decisions addObject:@(allow)]; }];
  check([quit requestQuit] == NSTerminateLater, "Joined quit requests remain pending");
  first(YES); check(replies.count == 0 && decisions.count == 0, "One approval cannot bypass another guard");
  second(NO); check([replies.lastObject isEqual:@NO], "A refusal must cancel");
  check(decisions.count == 2 && [decisions[0] isEqual:@NO] && [decisions[1] isEqual:@NO], "All joined observers must see the same veto");
  SparkQuitReply stale = first;
  [quit requestQuit]; pump(); stale(YES);
  check(replies.count == 1, "Stale replies cannot finish a new attempt");
  first(YES); first(YES); check(replies.count == 1, "Duplicate replies cannot approve another guard");
  second(YES); check([replies.lastObject isEqual:@YES], "All approvals should quit");
  [quit requestQuit]; pump(); [quit removeHandler:@"second"];
  check([replies.lastObject isEqual:@NO], "Removing a guard during quit must cancel");
  [quit observeDecision:^(BOOL allow) { [decisions addObject:@(allow)]; }];
  [quit requestQuit]; pump(0.15); check([replies.lastObject isEqual:@NO], "Timeout must cancel");
  check(decisions.count == 3 && [decisions.lastObject isEqual:@NO], "Timeout must settle observers");
  [quit removeHandler:@"first"]; check([quit requestQuit] == NSTerminateNow, "Removed guards cannot block quit");
  puts("Quit lifecycle tests passed");
} }
