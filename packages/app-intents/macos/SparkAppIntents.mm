#import "SparkAppIntents.h"
#include <cmath>

NSErrorDomain const SparkAppIntentsErrorDomain = @"so.legend.spark.app-intents";
NSString *const SparkAppIntentsInfoKey = @"SparkAppIntents";
NSString *const SparkAppEntitiesInfoKey = @"SparkAppEntities";
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
static BOOL IsTextList(id value) {
  if (![value isKindOfClass:NSArray.class]) return NO;
  for (id item in value) if (!Text(item)) return NO;
  return [NSSet setWithArray:value].count == [value count];
}

// Whether `item` (not null) is a value of the declared parameter: an enum's one of its values, an entity's its id.
static BOOL IsValue(NSDictionary *parameter, id item) {
  NSString *type = parameter[@"type"];
  if ([type isEqual:@"string"]) return [item isKindOfClass:NSString.class];
  if ([type isEqual:@"boolean"]) return IsBoolean(item);
  if ([type isEqual:@"number"]) return IsNumber(item);
  if ([type isEqual:@"integer"]) return IsNumber(item) && std::floor([item doubleValue]) == [item doubleValue] && std::fabs([item doubleValue]) <= 9007199254740991.0;
  if ([type isEqual:@"enum"]) return [parameter[@"values"] containsObject:item];
  return Text(item);
}

NSArray<NSDictionary *> *SparkAppIntentDeclarations(id value, NSError **error) {
  NSArray *list = [value isKindOfClass:NSArray.class] ? value : nil;
  NSMutableSet *ids = [NSMutableSet set];
  NSArray *types = @[@"string", @"number", @"integer", @"boolean", @"enum", @"entity"];
  for (NSDictionary *intent in list) {
    BOOL valid = [intent isKindOfClass:NSDictionary.class] && Name(intent[@"id"], YES) && ![ids containsObject:intent[@"id"]] && Text(intent[@"title"])
      && IsBoolean(intent[@"returnsText"]) && [intent[@"parameters"] isKindOfClass:NSArray.class];
    NSMutableSet *names = [NSMutableSet set];
    for (NSDictionary *parameter in valid ? intent[@"parameters"] : @[]) {
      valid = valid && [parameter isKindOfClass:NSDictionary.class] && Name(parameter[@"name"], NO) && ![names containsObject:parameter[@"name"]]
        && Text(parameter[@"title"]) && [types containsObject:parameter[@"type"]] && IsBoolean(parameter[@"optional"])
        && ([parameter[@"type"] isEqual:@"enum"] ? IsTextList(parameter[@"values"]) && [parameter[@"values"] count] > 0 : !parameter[@"values"])
        && ([parameter[@"type"] isEqual:@"entity"] ? Name(parameter[@"entity"], YES) && !parameter[@"default"] : !parameter[@"entity"])
        && (!parameter[@"default"] || IsValue(parameter, parameter[@"default"]));
      if (valid) [names addObject:parameter[@"name"]];
    }
    if (!valid) list = nil;
    else [ids addObject:intent[@"id"]];
  }
  if (!list && error) *error = Failure(@"E_INVALID_DATA", @"App Intent declarations are a list of { id, title, parameters: [{ name, title, type, optional, default?, values?, entity? }], returnsText } with unique ids and parameter names");
  return list;
}

NSArray<NSDictionary *> *SparkAppEntityDeclarations(id value, NSError **error) {
  NSArray *list = [value isKindOfClass:NSArray.class] ? value : nil;
  NSMutableSet *ids = [NSMutableSet set];
  for (NSDictionary *entity in list) {
    if (![entity isKindOfClass:NSDictionary.class] || !Name(entity[@"id"], YES) || [ids containsObject:entity[@"id"]] || !Text(entity[@"title"])) { list = nil; break; }
    [ids addObject:entity[@"id"]];
  }
  if (!list && error) *error = Failure(@"E_INVALID_DATA", @"App Entity declarations are a list of { id, title } with unique ids");
  return list;
}

// The parameters an invocation or donation passes, checked against the declaration: every declared one, optional
// ones may be missing or null (passed on as NSNull), a missing one with a default gets it, nothing undeclared.
static NSDictionary *Parameters(NSDictionary *intent, id value, NSError **error) {
  NSDictionary *given = [value isKindOfClass:NSDictionary.class] ? value : nil;
  NSString *problem = given ? nil : @"Parameters are an object";
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  for (NSDictionary *parameter in problem ? @[] : intent[@"parameters"]) {
    NSString *name = parameter[@"name"], *type = parameter[@"type"];
    id item = given[name] ?: parameter[@"default"];
    BOOL valid;
    if (!item || item == NSNull.null) { valid = [parameter[@"optional"] boolValue]; item = NSNull.null; }
    else valid = IsValue(parameter, item);
    if (!valid) {
      NSString *expected = [type isEqual:@"enum"] ? [NSString stringWithFormat:@"one of %@", [parameter[@"values"] componentsJoinedByString:@", "]]
        : [type isEqual:@"entity"] ? [NSString stringWithFormat:@"the id of a %@", parameter[@"entity"]]
        : [NSString stringWithFormat:@"%@%@", [type isEqual:@"integer"] ? @"an " : @"a ", type];
      problem = [NSString stringWithFormat:@"%@ needs %@ to be %@", intent[@"id"], name, expected];
      break;
    }
    result[name] = item;
  }
  for (NSString *key in problem ? @[] : given)
    if (!result[key]) { problem = [NSString stringWithFormat:@"%@ declares no parameter %@", intent[@"id"], key]; break; }
  if (problem && error) *error = Failure(@"E_INVALID_ARGUMENT", problem);
  return problem ? nil : result;
}

// An entity query: { kind: "identifiers", identifiers: [text] }, { kind: "suggested" } or { kind: "search", text }.
static BOOL IsQuery(id query) {
  if (![query isKindOfClass:NSDictionary.class]) return NO;
  NSString *kind = query[@"kind"];
  NSUInteger fields = [query count];
  if ([kind isEqual:@"identifiers"]) return fields == 2 && IsTextList(query[@"identifiers"]);
  if ([kind isEqual:@"search"]) return fields == 2 && [query[@"text"] isKindOfClass:NSString.class];
  return fields == 1 && [kind isEqual:@"suggested"];
}
// A query handler's entities: [{ id, title, subtitle? }] with unique ids.
static BOOL IsEntities(id entities) {
  if (![entities isKindOfClass:NSArray.class]) return NO;
  NSMutableSet *ids = [NSMutableSet set];
  for (NSDictionary *entity in entities) {
    if (![entity isKindOfClass:NSDictionary.class] || !Text(entity[@"id"]) || [ids containsObject:entity[@"id"]] || !Text(entity[@"title"])) return NO;
    if (entity[@"subtitle"] && ![entity[@"subtitle"] isKindOfClass:NSString.class]) return NO;
    if (entity.count != (entity[@"subtitle"] ? 3u : 2u)) return NO;
    [ids addObject:entity[@"id"]];
  }
  return YES;
}

@interface SparkAppIntentRequest : NSObject
@property (nonatomic) SparkAppIntentHandlerKind kind;
@property (nonatomic, copy) NSString *identifier;
// An invocation's parameters, or a query.
@property (nonatomic, copy) NSDictionary *arguments;
@property (nonatomic, copy) SparkAppIntentCompletion completion;
@property (nonatomic) BOOL delivered;
@end
@implementation SparkAppIntentRequest
@end

static NSString *HandlerKey(NSString *identifier, SparkAppIntentHandlerKind kind) { return [NSString stringWithFormat:@"%@/%@", kind == SparkAppIntentHandlerEntity ? @"entity" : @"intent", identifier]; }

@implementation SparkAppIntents {
  NSArray<NSDictionary *> *_entities;
  NSString *_unavailable;
  Class<SparkAppIntentDonating> _donor;
  NSMutableSet<NSString *> *_registered; // HandlerKey
  // Requests that have not completed, in arrival order.
  NSMutableArray<NSString *> *_order;
  NSMutableDictionary<NSString *, SparkAppIntentRequest *> *_pending;
#if SPARK_TEST_DRIVER
  NSMutableArray *_invocations;
  NSMutableArray *_queries;
  NSMutableArray *_donations;
#endif
}

- (instancetype)initWithDeclarations:(NSArray<NSDictionary *> *)declarations entities:(NSArray<NSDictionary *> *)entities unavailable:(NSString *)unavailable donor:(Class<SparkAppIntentDonating>)donor simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _declarations = [declarations copy];
    _entities = [entities copy];
    _unavailable = [unavailable copy];
    _donor = donor;
    _registered = [NSMutableSet set];
    _order = [NSMutableArray array];
    _pending = [NSMutableDictionary dictionary];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _declarations = @[]; // The driver declares intents (simulateDeclarations:); Info.plist is never read.
      _entities = @[];
      _unavailable = nil;
      _donor = nil;
      _invocations = [NSMutableArray array];
      _queries = [NSMutableArray array];
      _donations = [NSMutableArray array];
    }
#else
    NSAssert(!simulated, @"Simulated App Intents exist only in builds with the test driver");
#endif
  }
  return self;
}

- (BOOL)available { return _unavailable == nil; }

// The declaration of an intent or entity the app can run: E_UNAVAILABLE without compiled intents, E_NOT_FOUND when undeclared.
- (NSDictionary *)declaration:(NSString *)identifier kind:(SparkAppIntentHandlerKind)kind error:(NSError **)error
{
  BOOL entity = kind == SparkAppIntentHandlerEntity;
  NSError *failure = nil;
  NSDictionary *declaration = nil;
  if (!Text(identifier)) failure = Failure(@"E_INVALID_ARGUMENT", entity ? @"Expected an App Entity id" : @"Expected an App Intent id");
  else if (_unavailable) failure = Failure(@"E_UNAVAILABLE", _unavailable);
  else {
    for (NSDictionary *declared in entity ? _entities : _declarations) if ([declared[@"id"] isEqual:identifier]) declaration = declared;
    if (!declaration) failure = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:entity ? @"macos.appEntities declares no entity %@" : @"macos.appIntents declares no intent %@", identifier]);
  }
  if (failure && error) *error = failure;
  return declaration;
}

#pragma mark Handlers

- (BOOL)registerHandler:(NSString *)identifier kind:(SparkAppIntentHandlerKind)kind error:(NSError **)error
{
  if (![self declaration:identifier kind:kind error:error]) return NO;
  NSString *key = HandlerKey(identifier, kind);
  if ([_registered containsObject:key]) {
    if (error) *error = Failure(@"E_BUSY", [NSString stringWithFormat:kind == SparkAppIntentHandlerEntity ? @"App Entity %@ already has a query handler" : @"App Intent %@ already has a handler", identifier]);
    return NO;
  }
  [_registered addObject:key];
  for (NSString *requestId in [_order copy]) {
    SparkAppIntentRequest *request = _pending[requestId];
    if (request && !request.delivered && request.kind == kind && [request.identifier isEqual:identifier]) [self deliver:requestId];
  }
  return YES;
}

- (void)unregisterHandler:(NSString *)identifier kind:(SparkAppIntentHandlerKind)kind
{
  NSString *key = HandlerKey(identifier, kind);
  if (![_registered containsObject:key]) return;
  [_registered removeObject:key];
  for (NSString *requestId in [_order copy]) {
    SparkAppIntentRequest *request = _pending[requestId];
    if (request.delivered && request.kind == kind && [request.identifier isEqual:identifier])
      [self finish:requestId result:nil error:Failure(@"E_CLOSED", [NSString stringWithFormat:@"The handler for %@ was removed before it answered", identifier])];
  }
}

#pragma mark Requests

- (void)perform:(NSString *)identifier parameters:(NSDictionary *)parameters timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion
{
  NSError *error = nil;
  NSDictionary *intent = [self declaration:identifier kind:SparkAppIntentHandlerIntent error:&error];
  NSDictionary *checked = intent ? Parameters(intent, parameters, &error) : nil;
  [self request:SparkAppIntentHandlerIntent identifier:identifier arguments:checked given:parameters error:error timeout:timeout completion:completion];
}

- (void)query:(NSString *)entity query:(NSDictionary *)query timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion
{
  NSError *error = nil;
  BOOL declared = [self declaration:entity kind:SparkAppIntentHandlerEntity error:&error] != nil;
  if (declared && !IsQuery(query)) error = Failure(@"E_INVALID_ARGUMENT", @"An entity query is { kind: \"identifiers\", identifiers }, { kind: \"suggested\" } or { kind: \"search\", text }");
  [self request:SparkAppIntentHandlerEntity identifier:entity arguments:error ? nil : query given:query error:error timeout:timeout completion:completion];
}

// Holds or delivers a checked request (`arguments`), or fails it with `error`.
- (void)request:(SparkAppIntentHandlerKind)kind identifier:(NSString *)identifier arguments:(NSDictionary *)arguments given:(id)given error:(NSError *)error timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion
{
  BOOL handled = [_registered containsObject:HandlerKey(identifier, kind)];
  NSUInteger held = [_pending keysOfEntriesPassingTest:^BOOL(id, SparkAppIntentRequest *request, BOOL *) { return !request.delivered; }].count;
  if (!error && held >= HeldLimit && !handled)
    error = Failure(@"E_BUSY", [NSString stringWithFormat:@"%lu App Intent requests are already waiting for a handler", (unsigned long)HeldLimit]);
  if (error) {
#if SPARK_TEST_DRIVER
    if (_simulated) [self record:kind identifier:identifier ?: @"" arguments:[given isKindOfClass:NSDictionary.class] ? given : @{} result:nil error:error];
#endif
    dispatch_async(dispatch_get_main_queue(), ^{ completion(nil, error); });
    return;
  }
  SparkAppIntentRequest *request = [SparkAppIntentRequest new];
  request.kind = kind;
  request.identifier = identifier;
  request.arguments = arguments;
  request.completion = completion;
  NSString *requestId = NSUUID.UUID.UUIDString;
  _pending[requestId] = request;
  [_order addObject:requestId];
  __weak SparkAppIntents *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weakSelf finish:requestId result:nil error:Failure(@"E_TIMEOUT", [NSString stringWithFormat:@"The app did not answer %@ within %g s", identifier, timeout])];
  });
  if (handled) [self deliver:requestId];
}

- (void)deliver:(NSString *)requestId
{
  SparkAppIntentRequest *request = _pending[requestId];
  request.delivered = YES;
  if (!_delivery) return;
  if (request.kind == SparkAppIntentHandlerEntity) _delivery(@{ @"type": @"appEntityQueried", @"requestId": requestId, @"entity": request.identifier, @"query": request.arguments });
  else _delivery(@{ @"type": @"appIntentInvoked", @"requestId": requestId, @"id": request.identifier, @"parameters": request.arguments });
}

- (BOOL)answer:(NSString *)requestId result:(id)result failure:(NSError *)failure error:(NSError **)error
{
  SparkAppIntentRequest *request = [requestId isKindOfClass:NSString.class] ? _pending[requestId] : nil;
  if (!request.delivered) {
    if (error) *error = Failure(@"E_CLOSED", @"The App Intent request already ended: it timed out or its handler was removed");
    return NO;
  }
  if (failure) { [self finish:requestId result:nil error:failure]; return YES; }
  NSString *message = nil;
  if (request.kind == SparkAppIntentHandlerEntity) {
    if (!IsEntities(result)) message = [NSString stringWithFormat:@"The query handler for %@ must return a list of { id, title, subtitle? } with unique ids", request.identifier];
  } else {
    BOOL returnsText = [[self declaration:request.identifier kind:SparkAppIntentHandlerIntent error:nil][@"returnsText"] boolValue];
    if (returnsText != [result isKindOfClass:NSString.class]) message = returnsText ? [NSString stringWithFormat:@"The handler for %@ must return text", request.identifier]
      : [NSString stringWithFormat:@"The handler for %@ returned text, but the intent returns none (returnsText)", request.identifier];
    else if (!returnsText) result = nil;
  }
  if (!message) { [self finish:requestId result:result error:nil]; return YES; }
  [self finish:requestId result:nil error:Failure(@"E_INVALID_DATA", message)];
  if (error) *error = Failure(@"E_INVALID_ARGUMENT", message);
  return NO;
}

- (void)finish:(NSString *)requestId result:(id)result error:(NSError *)error
{
  SparkAppIntentRequest *request = _pending[requestId];
  if (!request) return;
  [_pending removeObjectForKey:requestId];
  [_order removeObject:requestId];
#if SPARK_TEST_DRIVER
  if (_simulated) [self record:request.kind identifier:request.identifier arguments:request.arguments result:result error:error];
#endif
  request.completion(result, error);
}

#pragma mark Donation

- (void)donate:(NSString *)identifier parameters:(NSDictionary *)parameters completion:(SparkAppIntentsDone)completion
{
  __block SparkAppIntentsDone pending = [completion copy];
  SparkAppIntentsDone done = ^(NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{ SparkAppIntentsDone callback = pending; pending = nil; if (callback) callback(error); });
  };
  NSError *error = nil;
  NSDictionary *intent = [self declaration:identifier kind:SparkAppIntentHandlerIntent error:&error];
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

- (void)record:(SparkAppIntentHandlerKind)kind identifier:(NSString *)identifier arguments:(NSDictionary *)arguments result:(id)result error:(NSError *)error
{
  BOOL entity = kind == SparkAppIntentHandlerEntity;
  NSMutableDictionary *record = [(entity ? @{ @"entity": identifier, @"query": arguments } : @{ @"id": identifier, @"parameters": arguments }) mutableCopy];
  if (error) record[@"error"] = @{ @"code": SparkAppIntentsErrorCode(error), @"message": error.localizedDescription };
  else if (result) record[entity ? @"entities" : @"text"] = result;
  [(entity ? _queries : _invocations) addObject:record];
}

- (BOOL)simulateDeclarations:(id)declarations entities:(id)entities error:(NSError **)error
{
  if (!_simulated) {
    if (error) *error = Failure(@"E_UNAVAILABLE", @"App Intents simulation needs the test driver");
    return NO;
  }
  NSArray *intents = declarations ? SparkAppIntentDeclarations(declarations, error) : _declarations;
  NSArray *types = intents && entities ? SparkAppEntityDeclarations(entities, error) : _entities;
  if (!intents || !types) return NO;
  _declarations = intents;
  _entities = types;
  return YES;
}

- (NSDictionary *)simulation
{
  NSMutableArray *registered = [NSMutableArray array], *registeredEntities = [NSMutableArray array];
  for (NSString *key in [_registered.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
    NSArray *parts = [key componentsSeparatedByString:@"/"];
    [([parts[0] isEqual:@"entity"] ? registeredEntities : registered) addObject:parts[1]];
  }
  return @{ @"declared": [_declarations valueForKey:@"id"], @"registered": registered, @"entities": [_entities valueForKey:@"id"], @"registeredEntities": registeredEntities,
    @"invocations": [_invocations copy], @"queries": [_queries copy], @"pending": @(_pending.count), @"donations": [_donations copy] };
}
#endif
@end
