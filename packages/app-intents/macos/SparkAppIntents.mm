#import "SparkAppIntents.h"
#include <cmath>

NSErrorDomain const SparkAppIntentsErrorDomain = @"so.legend.spark.app-intents";
NSString *const SparkAppIntentsInfoKey = @"SparkAppIntents";
const NSTimeInterval SparkAppIntentTimeout = 30;
static const NSUInteger HeldLimit = 20;

static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkAppIntentsErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkAppIntentsErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}
static BOOL Text(id value) { return [value isKindOfClass:NSString.class] && [value length] > 0; }
static BOOL Name(id value, BOOL upper) {
  if (!Text(value) || [value length] > 64) return NO;
  NSString *pattern = upper ? @"^[A-Za-z][A-Za-z0-9]*$" : @"^[a-z][A-Za-z0-9]*$";
  return [value rangeOfString:pattern options:NSRegularExpressionSearch].location != NSNotFound;
}
static BOOL IsBoolean(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
static BOOL IsNumber(id value) { return [value isKindOfClass:NSNumber.class] && !IsBoolean(value) && std::isfinite([value doubleValue]); }

NSArray<NSDictionary *> *SparkAppIntentDeclarations(id value, NSError **error) {
  NSArray *list = [value isKindOfClass:NSArray.class] ? value : nil;
  NSMutableSet *ids = [NSMutableSet set];
  NSArray *types = @[@"string", @"number", @"integer", @"boolean"];
  for (NSDictionary *intent in list) {
    BOOL valid = [intent isKindOfClass:NSDictionary.class] && Name(intent[@"id"], YES) && ![ids containsObject:intent[@"id"]] && Text(intent[@"title"])
      && IsBoolean(intent[@"returnsText"]) && [intent[@"parameters"] isKindOfClass:NSArray.class];
    NSMutableSet *names = [NSMutableSet set];
    for (NSDictionary *parameter in valid ? intent[@"parameters"] : @[]) {
      valid = valid && [parameter isKindOfClass:NSDictionary.class] && Name(parameter[@"name"], NO) && ![names containsObject:parameter[@"name"]]
        && Text(parameter[@"title"]) && [types containsObject:parameter[@"type"]] && IsBoolean(parameter[@"optional"]);
      if (valid) [names addObject:parameter[@"name"]];
    }
    if (!valid) list = nil;
    else [ids addObject:intent[@"id"]];
  }
  if (!list && error) *error = Failure(@"E_INVALID_DATA", @"App Intent declarations are a list of { id, title, parameters: [{ name, title, type, optional }], returnsText } with unique ids and parameter names");
  return list;
}

// The parameters an invocation or donation passes, checked against the declaration: every declared one, optional
// ones may be missing or null (passed on as NSNull), nothing undeclared.
static NSDictionary *Parameters(NSDictionary *intent, id value, NSError **error) {
  NSDictionary *given = [value isKindOfClass:NSDictionary.class] ? value : nil;
  NSString *problem = given ? nil : @"Parameters are an object";
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  for (NSDictionary *parameter in problem ? @[] : intent[@"parameters"]) {
    NSString *name = parameter[@"name"], *type = parameter[@"type"];
    id item = given[name];
    BOOL valid;
    if (!item || item == NSNull.null) { valid = [parameter[@"optional"] boolValue]; item = NSNull.null; }
    else if ([type isEqual:@"string"]) valid = [item isKindOfClass:NSString.class];
    else if ([type isEqual:@"boolean"]) valid = IsBoolean(item);
    else if ([type isEqual:@"number"]) valid = IsNumber(item);
    else valid = IsNumber(item) && std::floor([item doubleValue]) == [item doubleValue] && std::fabs([item doubleValue]) <= 9007199254740991.0;
    if (!valid) { problem = [NSString stringWithFormat:@"%@ needs %@ to be %@%@", intent[@"id"], name, [type isEqual:@"integer"] ? @"an " : @"a ", type]; break; }
    result[name] = item;
  }
  for (NSString *key in problem ? @[] : given)
    if (!result[key]) { problem = [NSString stringWithFormat:@"%@ declares no parameter %@", intent[@"id"], key]; break; }
  if (problem && error) *error = Failure(@"E_INVALID_ARGUMENT", problem);
  return problem ? nil : result;
}

@interface SparkAppIntentRequest : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSDictionary *parameters;
@property (nonatomic, copy) SparkAppIntentCompletion completion;
@property (nonatomic) BOOL delivered;
@end
@implementation SparkAppIntentRequest
@end

@implementation SparkAppIntents {
  NSString *_unavailable;
  Class<SparkAppIntentDonating> _donor;
  NSMutableSet<NSString *> *_registered;
  // Invocations that have not completed, in arrival order.
  NSMutableArray<NSString *> *_order;
  NSMutableDictionary<NSString *, SparkAppIntentRequest *> *_pending;
#if SPARK_TEST_DRIVER
  NSMutableArray *_invocations;
  NSMutableArray *_donations;
#endif
}

- (instancetype)initWithDeclarations:(NSArray<NSDictionary *> *)declarations unavailable:(NSString *)unavailable donor:(Class<SparkAppIntentDonating>)donor simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _declarations = [declarations copy];
    _unavailable = [unavailable copy];
    _donor = donor;
    _registered = [NSMutableSet set];
    _order = [NSMutableArray array];
    _pending = [NSMutableDictionary dictionary];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _declarations = @[]; // The driver declares intents (simulateDeclarations:); Info.plist is never read.
      _unavailable = nil;
      _donor = nil;
      _invocations = [NSMutableArray array];
      _donations = [NSMutableArray array];
    }
#else
    NSAssert(!simulated, @"Simulated App Intents exist only in builds with the test driver");
#endif
  }
  return self;
}

- (BOOL)available { return _unavailable == nil; }

// The declaration of an id the app can run: E_UNAVAILABLE without compiled intents, E_NOT_FOUND when undeclared.
- (NSDictionary *)intent:(NSString *)identifier error:(NSError **)error
{
  NSError *failure = nil;
  NSDictionary *intent = nil;
  if (!Text(identifier)) failure = Failure(@"E_INVALID_ARGUMENT", @"Expected an App Intent id");
  else if (_unavailable) failure = Failure(@"E_UNAVAILABLE", _unavailable);
  else {
    for (NSDictionary *declared in _declarations) if ([declared[@"id"] isEqual:identifier]) intent = declared;
    if (!intent) failure = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:@"macos.appIntents declares no intent %@", identifier]);
  }
  if (failure && error) *error = failure;
  return intent;
}

#pragma mark Handlers

- (BOOL)registerHandler:(NSString *)identifier error:(NSError **)error
{
  if (![self intent:identifier error:error]) return NO;
  if ([_registered containsObject:identifier]) {
    if (error) *error = Failure(@"E_BUSY", [NSString stringWithFormat:@"App Intent %@ already has a handler", identifier]);
    return NO;
  }
  [_registered addObject:identifier];
  for (NSString *requestId in [_order copy]) {
    SparkAppIntentRequest *request = _pending[requestId];
    if (request && !request.delivered && [request.identifier isEqual:identifier]) [self deliver:requestId];
  }
  return YES;
}

- (void)unregisterHandler:(NSString *)identifier
{
  if (![_registered containsObject:identifier]) return;
  [_registered removeObject:identifier];
  for (NSString *requestId in [_order copy]) {
    SparkAppIntentRequest *request = _pending[requestId];
    if (request.delivered && [request.identifier isEqual:identifier])
      [self finish:requestId text:nil error:Failure(@"E_CLOSED", [NSString stringWithFormat:@"The handler for %@ was removed before it answered", identifier])];
  }
}

#pragma mark Invocations

- (void)perform:(NSString *)identifier parameters:(NSDictionary *)parameters timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion
{
  NSError *error = nil;
  NSDictionary *intent = [self intent:identifier error:&error];
  NSDictionary *checked = intent ? Parameters(intent, parameters, &error) : nil;
  NSUInteger held = [_pending keysOfEntriesPassingTest:^BOOL(id, SparkAppIntentRequest *request, BOOL *) { return !request.delivered; }].count;
  if (checked && held >= HeldLimit && ![_registered containsObject:identifier])
    error = Failure(@"E_BUSY", [NSString stringWithFormat:@"%lu App Intent invocations are already waiting for a handler", (unsigned long)HeldLimit]);
  if (error) {
#if SPARK_TEST_DRIVER
    if (_simulated) [_invocations addObject:@{ @"id": identifier ?: @"", @"parameters": parameters ?: @{}, @"error": @{ @"code": SparkAppIntentsErrorCode(error), @"message": error.localizedDescription } }];
#endif
    dispatch_async(dispatch_get_main_queue(), ^{ completion(nil, error); });
    return;
  }
  SparkAppIntentRequest *request = [SparkAppIntentRequest new];
  request.identifier = identifier;
  request.parameters = checked;
  request.completion = completion;
  NSString *requestId = NSUUID.UUID.UUIDString;
  _pending[requestId] = request;
  [_order addObject:requestId];
  __weak SparkAppIntents *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weakSelf finish:requestId text:nil error:Failure(@"E_TIMEOUT", [NSString stringWithFormat:@"The app did not answer %@ within %g s", identifier, timeout])];
  });
  if ([_registered containsObject:identifier]) [self deliver:requestId];
}

- (void)deliver:(NSString *)requestId
{
  SparkAppIntentRequest *request = _pending[requestId];
  request.delivered = YES;
  if (_delivery) _delivery(@{ @"requestId": requestId, @"id": request.identifier, @"parameters": request.parameters });
}

- (BOOL)answer:(NSString *)requestId text:(NSString *)text failure:(NSError *)failure error:(NSError **)error
{
  SparkAppIntentRequest *request = [requestId isKindOfClass:NSString.class] ? _pending[requestId] : nil;
  if (!request.delivered) {
    if (error) *error = Failure(@"E_CLOSED", @"The App Intent invocation already ended: it timed out or its handler was removed");
    return NO;
  }
  if (failure) { [self finish:requestId text:nil error:failure]; return YES; }
  BOOL returnsText = NO;
  for (NSDictionary *declared in _declarations) if ([declared[@"id"] isEqual:request.identifier]) returnsText = [declared[@"returnsText"] boolValue];
  if (returnsText == [text isKindOfClass:NSString.class]) { [self finish:requestId text:text error:nil]; return YES; }
  NSString *message = returnsText ? [NSString stringWithFormat:@"The handler for %@ must return text", request.identifier]
    : [NSString stringWithFormat:@"The handler for %@ returned text, but the intent returns none (returnsText)", request.identifier];
  [self finish:requestId text:nil error:Failure(@"E_INVALID_DATA", message)];
  if (error) *error = Failure(@"E_INVALID_ARGUMENT", message);
  return NO;
}

- (void)finish:(NSString *)requestId text:(NSString *)text error:(NSError *)error
{
  SparkAppIntentRequest *request = _pending[requestId];
  if (!request) return;
  [_pending removeObjectForKey:requestId];
  [_order removeObject:requestId];
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSMutableDictionary *record = [@{ @"id": request.identifier, @"parameters": request.parameters } mutableCopy];
    if (error) record[@"error"] = @{ @"code": SparkAppIntentsErrorCode(error), @"message": error.localizedDescription };
    else if (text) record[@"text"] = text;
    [_invocations addObject:record];
  }
#endif
  request.completion(text, error);
}

#pragma mark Donation

- (void)donate:(NSString *)identifier parameters:(NSDictionary *)parameters completion:(SparkAppIntentsDone)completion
{
  __block SparkAppIntentsDone pending = [completion copy];
  SparkAppIntentsDone done = ^(NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{ SparkAppIntentsDone callback = pending; pending = nil; if (callback) callback(error); });
  };
  NSError *error = nil;
  NSDictionary *intent = [self intent:identifier error:&error];
  NSDictionary *checked = intent ? Parameters(intent, parameters, &error) : nil;
  if (!checked) return done(error);
#if SPARK_TEST_DRIVER
  if (_simulated) { [_donations addObject:@{ @"id": identifier, @"parameters": checked }]; return done(nil); }
#endif
  [_donor donate:identifier parameters:checked completionHandler:^(NSError *failure) {
    done(failure ? Failure(@"E_NATIVE", [NSString stringWithFormat:@"Donating %@ failed: %@", identifier, failure.localizedDescription]) : nil);
  }];
}

#if SPARK_TEST_DRIVER
#pragma mark Simulation

- (BOOL)simulateDeclarations:(id)declarations error:(NSError **)error
{
  if (!_simulated) {
    if (error) *error = Failure(@"E_UNAVAILABLE", @"App Intents simulation needs the test driver");
    return NO;
  }
  NSArray *checked = SparkAppIntentDeclarations(declarations, error);
  if (!checked) return NO;
  _declarations = checked;
  return YES;
}

- (NSDictionary *)simulation
{
  NSArray *declared = [_declarations valueForKey:@"id"];
  return @{ @"declared": declared, @"registered": [_registered.allObjects sortedArrayUsingSelector:@selector(compare:)],
    @"invocations": [_invocations copy], @"pending": @(_pending.count), @"donations": [_donations copy] };
}
#endif
@end
