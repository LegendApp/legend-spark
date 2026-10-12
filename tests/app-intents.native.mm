// App Intents (packages/app-intents/macos/SparkAppIntents.mm). Never reaches the system: invocations come from this
// test as the generated Swift intents would send them, and donations go to a fake generated class.
#import <Foundation/Foundation.h>
#import "SparkAppIntents.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(NSTimeInterval seconds = 0.05) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }

static NSMutableArray *Donated;
static NSError *DonationFailure;
@interface FakeGeneratedAppIntents : NSObject <SparkAppIntentDonating>
@end
@implementation FakeGeneratedAppIntents
+ (void)donate:(NSString *)identifier parameters:(NSDictionary *)parameters completionHandler:(void (^)(NSError *))completionHandler
{
  [Donated addObject:@{ @"id": identifier, @"parameters": parameters }];
  // As Swift async methods do, completes on another thread.
  NSError *failure = DonationFailure;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ completionHandler(failure); });
}
@end

typedef struct { int calls; NSString *text; NSString *code; NSString *message; } Outcome;
static SparkAppIntentCompletion Completion(Outcome *outcome) {
  return ^(NSString *text, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++; outcome->text = text; outcome->code = error ? SparkAppIntentsErrorCode(error) : nil; outcome->message = error.localizedDescription;
  };
}
static SparkAppIntentsDone Done(Outcome *outcome) {
  return ^(NSError *error) { CHECK(NSThread.isMainThread); outcome->calls++; outcome->code = error ? SparkAppIntentsErrorCode(error) : nil; outcome->message = error.localizedDescription; };
}

int main() { @autoreleasepool {
  NSError *error = nil;
  Donated = [NSMutableArray array];
  NSArray *declared = @[
    @{ @"id": @"showRecipe", @"title": @"Show Recipe", @"returnsText": @YES, @"parameters": @[
      @{ @"name": @"recipe", @"title": @"Recipe", @"type": @"string", @"optional": @NO },
      @{ @"name": @"servings", @"title": @"Servings", @"type": @"integer", @"optional": @YES } ] },
    @{ @"id": @"startTimer", @"title": @"Start Timer", @"returnsText": @NO, @"parameters": @[
      @{ @"name": @"minutes", @"title": @"Minutes", @"type": @"number", @"optional": @NO },
      @{ @"name": @"loud", @"title": @"Loud", @"type": @"boolean", @"optional": @YES } ] } ];

  // Declarations as Info.plist lists them: ids and parameter names are identifiers, unique; types are known.
  CHECK([SparkAppIntentDeclarations(declared, &error) isEqual:declared]);
  CHECK([SparkAppIntentDeclarations(@[], &error) isEqual:@[]]);
  CHECK(!SparkAppIntentDeclarations(@"bad", &error) && [SparkAppIntentsErrorCode(error) isEqual:@"E_INVALID_DATA"]);
  CHECK(!SparkAppIntentDeclarations(@[declared[0], declared[0]], &error));
  CHECK(!SparkAppIntentDeclarations(@[@{ @"id": @"show-recipe", @"title": @"T", @"returnsText": @NO, @"parameters": @[] }], &error));
  CHECK(!SparkAppIntentDeclarations(@[@{ @"id": @"show", @"title": @"T", @"returnsText": @1, @"parameters": @[] }], &error));
  CHECK(!SparkAppIntentDeclarations(@[@{ @"id": @"show", @"title": @"T", @"returnsText": @NO, @"parameters": @[@{ @"name": @"Recipe", @"title": @"R", @"type": @"string", @"optional": @NO }] }], &error));
  CHECK(!SparkAppIntentDeclarations(@[@{ @"id": @"show", @"title": @"T", @"returnsText": @NO, @"parameters": @[@{ @"name": @"recipe", @"title": @"R", @"type": @"date", @"optional": @NO }] }], &error));

  // An app whose build cannot run intents (the Spark Runner): everything is unavailable with the reason.
  SparkAppIntents *runner = [[SparkAppIntents alloc] initWithDeclarations:@[] unavailable:@"No intents here" donor:nil simulated:NO];
  Outcome runnerPerform = {}, runnerDonate = {};
  CHECK(!runner.available);
  CHECK(![runner registerHandler:@"showRecipe" error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_UNAVAILABLE"] && [error.localizedDescription isEqual:@"No intents here"]);
  [runner perform:@"showRecipe" parameters:@{ @"recipe": @"Pancakes" } timeout:5 completion:Completion(&runnerPerform)];
  [runner donate:@"showRecipe" parameters:@{ @"recipe": @"Pancakes" } completion:Done(&runnerDonate)];
  Drain();
  CHECK(runnerPerform.calls == 1 && [runnerPerform.code isEqual:@"E_UNAVAILABLE"] && runnerDonate.calls == 1 && [runnerDonate.code isEqual:@"E_UNAVAILABLE"]);

  // A compiled app.
  SparkAppIntents *intents = [[SparkAppIntents alloc] initWithDeclarations:declared unavailable:nil donor:FakeGeneratedAppIntents.class simulated:NO];
  NSMutableArray<NSDictionary *> *delivered = [NSMutableArray array];
  intents.delivery = ^(NSDictionary *request) { [delivered addObject:request]; };
  CHECK(intents.available && !intents.simulated);
  CHECK(![intents registerHandler:@"missing" error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK(![intents registerHandler:@"" error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);

  // Parameters are checked against the declaration before anything is delivered.
  NSArray *invalid = @[@{}, @{ @"recipe": @1 }, @{ @"recipe": @"A", @"servings": @1.5 }, @{ @"recipe": @"A", @"servings": @YES }, @{ @"recipe": @"A", @"extra": @"x" }, @{ @"recipe": NSNull.null }];
  for (NSDictionary *parameters in invalid) {
    Outcome outcome = {};
    [intents perform:@"showRecipe" parameters:parameters timeout:5 completion:Completion(&outcome)];
    Drain(0.01);
    CHECK(outcome.calls == 1 && [outcome.code isEqual:@"E_INVALID_ARGUMENT"]);
  }
  Outcome badTimer = {};
  [intents perform:@"startTimer" parameters:@{ @"minutes": @5, @"loud": @1 } timeout:5 completion:Completion(&badTimer)];
  Drain(0.01);
  CHECK([badTimer.code isEqual:@"E_INVALID_ARGUMENT"]);

  // An invocation before any handler waits for one, then is delivered with every parameter (missing optionals null).
  Outcome held = {};
  [intents perform:@"showRecipe" parameters:@{ @"recipe": @"Pancakes" } timeout:5 completion:Completion(&held)];
  Drain();
  CHECK(held.calls == 0 && delivered.count == 0);
  CHECK([intents registerHandler:@"showRecipe" error:&error]);
  CHECK(![intents registerHandler:@"showRecipe" error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_BUSY"]);
  CHECK(delivered.count == 1 && [delivered[0][@"id"] isEqual:@"showRecipe"] && [delivered[0][@"parameters"] isEqual:(@{ @"recipe": @"Pancakes", @"servings": NSNull.null })]);
  CHECK([intents answer:delivered[0][@"requestId"] text:@"Pancakes for 2" failure:nil error:&error]);
  CHECK(held.calls == 1 && [held.text isEqual:@"Pancakes for 2"] && !held.code);
  // It completed exactly once: a second answer finds nothing.
  CHECK(![intents answer:delivered[0][@"requestId"] text:@"again" failure:nil error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_CLOSED"]);
  CHECK(held.calls == 1);

  // An intent that returns text must get text, and one that returns none must get none.
  Outcome noText = {}, extraText = {}, failed = {};
  [intents perform:@"showRecipe" parameters:@{ @"recipe": @"Gazpacho", @"servings": @4 } timeout:5 completion:Completion(&noText)];
  CHECK(delivered.count == 2 && [delivered[1][@"parameters"][@"servings"] isEqual:@4]);
  CHECK(![intents answer:delivered[1][@"requestId"] text:nil failure:nil error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(noText.calls == 1 && [noText.code isEqual:@"E_INVALID_DATA"]);
  CHECK([intents registerHandler:@"startTimer" error:&error]);
  [intents perform:@"startTimer" parameters:@{ @"minutes": @2.5, @"loud": @YES } timeout:5 completion:Completion(&extraText)];
  CHECK(![intents answer:delivered[2][@"requestId"] text:@"started" failure:nil error:&error] && [extraText.code isEqual:@"E_INVALID_DATA"]);
  // A handler's failure reaches the system with its code and message.
  [intents perform:@"startTimer" parameters:@{ @"minutes": @90 } timeout:5 completion:Completion(&failed)];
  NSError *tooLong = [NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"At most 60 minutes" }];
  CHECK([intents answer:delivered[3][@"requestId"] text:nil failure:tooLong error:&error]);
  CHECK(failed.calls == 1 && [failed.code isEqual:@"E_INVALID_ARGUMENT"] && [failed.message isEqual:@"At most 60 minutes"]);
  Outcome timer = {};
  [intents perform:@"startTimer" parameters:@{ @"minutes": @1 } timeout:5 completion:Completion(&timer)];
  CHECK([intents answer:delivered[4][@"requestId"] text:nil failure:nil error:&error] && timer.calls == 1 && !timer.code && !timer.text);

  // The timeout bounds an unanswered invocation; a late answer is refused.
  Outcome slow = {};
  [intents perform:@"showRecipe" parameters:@{ @"recipe": @"Shortbread" } timeout:0.1 completion:Completion(&slow)];
  Drain(0.3);
  CHECK(slow.calls == 1 && [slow.code isEqual:@"E_TIMEOUT"]);
  CHECK(![intents answer:delivered[5][@"requestId"] text:@"late" failure:nil error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_CLOSED"] && slow.calls == 1);

  // Removing a handler fails what it was given and has not answered; later invocations wait for the next handler.
  Outcome orphaned = {}, waiting = {};
  [intents perform:@"showRecipe" parameters:@{ @"recipe": @"Soup" } timeout:5 completion:Completion(&orphaned)];
  [intents unregisterHandler:@"showRecipe"];
  CHECK(orphaned.calls == 1 && [orphaned.code isEqual:@"E_CLOSED"]);
  [intents perform:@"showRecipe" parameters:@{ @"recipe": @"Stew" } timeout:5 completion:Completion(&waiting)];
  NSUInteger before = delivered.count;
  CHECK([intents registerHandler:@"showRecipe" error:&error] && delivered.count == before + 1);
  CHECK([intents answer:delivered.lastObject[@"requestId"] text:@"Stew" failure:nil error:&error] && [waiting.text isEqual:@"Stew"]);

  // At most 20 invocations wait for a handler.
  [intents unregisterHandler:@"showRecipe"];
  Outcome waits[21] = {};
  for (int i = 0; i < 21; i++) [intents perform:@"showRecipe" parameters:@{ @"recipe": @"R" } timeout:0.2 completion:Completion(&waits[i])];
  Drain(0.05);
  CHECK(waits[19].calls == 0 && waits[20].calls == 1 && [waits[20].code isEqual:@"E_BUSY"]);
  Drain(0.4);
  CHECK(waits[0].calls == 1 && [waits[0].code isEqual:@"E_TIMEOUT"]);

  // Donations go to the generated class with checked parameters and complete once, on the main thread.
  Outcome donated = {}, badDonation = {}, failedDonation = {};
  [intents donate:@"showRecipe" parameters:@{ @"recipe": @"Pancakes", @"servings": @2 } completion:Done(&donated)];
  [intents donate:@"showRecipe" parameters:@{ @"servings": @2 } completion:Done(&badDonation)];
  Drain();
  CHECK(donated.calls == 1 && !donated.code && badDonation.calls == 1 && [badDonation.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(Donated.count == 1 && [Donated[0] isEqual:(@{ @"id": @"showRecipe", @"parameters": @{ @"recipe": @"Pancakes", @"servings": @2 } })]);
  DonationFailure = [NSError errorWithDomain:@"AppIntents" code:1 userInfo:@{ NSLocalizedDescriptionKey: @"Donations are off" }];
  [intents donate:@"startTimer" parameters:@{ @"minutes": @1 } completion:Done(&failedDonation)];
  Drain();
  CHECK(failedDonation.calls == 1 && [failedDonation.code isEqual:@"E_NATIVE"] && [failedDonation.message containsString:@"Donations are off"]);

#if SPARK_TEST_DRIVER
  // The simulation ignores Info.plist and the generated class: the driver declares intents and donations are recorded.
  CHECK(![intents simulateDeclarations:declared error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
  SparkAppIntents *simulated = [[SparkAppIntents alloc] initWithDeclarations:declared unavailable:@"ignored" donor:FakeGeneratedAppIntents.class simulated:YES];
  NSMutableArray<NSDictionary *> *simulatedDelivered = [NSMutableArray array];
  simulated.delivery = ^(NSDictionary *request) { [simulatedDelivered addObject:request]; };
  CHECK(simulated.available && simulated.declarations.count == 0);
  CHECK(![simulated registerHandler:@"showRecipe" error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK(![simulated simulateDeclarations:@[@{ @"id": @"x" }] error:&error] && [SparkAppIntentsErrorCode(error) isEqual:@"E_INVALID_DATA"]);
  CHECK([simulated simulateDeclarations:declared error:&error] && [simulated registerHandler:@"showRecipe" error:&error]);
  Outcome simulatedRun = {}, simulatedDonation = {};
  [simulated perform:@"showRecipe" parameters:@{ @"recipe": @"Pancakes" } timeout:5 completion:Completion(&simulatedRun)];
  [simulated answer:simulatedDelivered[0][@"requestId"] text:@"Pancakes" failure:nil error:&error];
  [simulated perform:@"startTimer" parameters:@{} timeout:5 completion:^(NSString *, NSError *) {}];
  [simulated donate:@"showRecipe" parameters:@{ @"recipe": @"Gazpacho" } completion:Done(&simulatedDonation)];
  Drain();
  CHECK(simulatedRun.calls == 1 && simulatedDonation.calls == 1 && !simulatedDonation.code && Donated.count == 2);
  NSDictionary *state = simulated.simulation;
  CHECK([state[@"declared"] isEqual:(@[@"showRecipe", @"startTimer"])] && [state[@"registered"] isEqual:@[@"showRecipe"]] && [state[@"pending"] isEqual:@0]);
  CHECK([state[@"invocations"] count] == 2 && [state[@"invocations"][0] isEqual:(@{ @"id": @"showRecipe", @"parameters": @{ @"recipe": @"Pancakes", @"servings": NSNull.null }, @"text": @"Pancakes" })]);
  CHECK([state[@"invocations"][1][@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK([state[@"donations"] isEqual:(@[@{ @"id": @"showRecipe", @"parameters": @{ @"recipe": @"Gazpacho", @"servings": NSNull.null } }])]);
#endif
  printf("App Intents native tests passed\n");
} return 0; }
