#import "SparkQuitCoordinator.h"
static void pump(double seconds = 0.02) { [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }
// Pump until a condition holds, with a generous deadline so slow CI hosts cannot flake.
static void pumpUntil(BOOL (^done)(void), double limit = 5) { NSDate *end = [NSDate dateWithTimeIntervalSinceNow:limit]; while (!done() && end.timeIntervalSinceNow > 0) pump(0.01); }
static void check(BOOL value, const char *message) { if (!value) { fprintf(stderr, "%s\n", message); exit(1); } }
int main() { @autoreleasepool {
  __block NSMutableArray<NSNumber *> *replies = [NSMutableArray new];
  SparkQuitCoordinator *quit = [[SparkQuitCoordinator alloc] initWithReply:^(BOOL allow) { [replies addObject:@(allow)]; } timeout:60];
  // Guard semantics use a long timeout: a stalled run loop on a slow host must not let the
  // timeout cancel the attempt mid-test. Timeout behavior is covered by its own coordinator below.
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
  check(decisions.count == 2, "Removing a guard must not settle unrelated observers");
  __block NSMutableArray<NSNumber *> *timedReplies = [NSMutableArray new], *timedDecisions = [NSMutableArray new];
  SparkQuitCoordinator *timed = [[SparkQuitCoordinator alloc] initWithReply:^(BOOL allow) { [timedReplies addObject:@(allow)]; } timeout:0.1];
  [timed registerHandler:@"silent" handler:^(SparkQuitReply reply) {}];
  [timed observeDecision:^(BOOL allow) { [timedDecisions addObject:@(allow)]; }];
  check([timed requestQuit] == NSTerminateLater, "Timed guard must defer");
  pumpUntil(^{ return (BOOL)(timedReplies.count > 0); });
  check(timedReplies.count == 1 && [timedReplies.lastObject isEqual:@NO], "Timeout must cancel");
  check(timedDecisions.count == 1 && [timedDecisions.lastObject isEqual:@NO], "Timeout must settle observers");
  [timed removeHandler:@"silent"];
  [quit removeHandler:@"first"]; check([quit requestQuit] == NSTerminateNow, "Removed guards cannot block quit");
  puts("Quit lifecycle tests passed");
} }
