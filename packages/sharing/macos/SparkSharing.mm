#import "SparkSharing.h"
#import <CoreSpotlight/CoreSpotlight.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

NSErrorDomain const SparkSharingErrorDomain = @"so.legend.spark.sharing";
NSString *const SparkServiceMessage = @"sparkService";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkSharingErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkSharingErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkSharingErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}
static BOOL Text(id value) { return [value isKindOfClass:NSString.class] && [value length] > 0; }

NSArray *SparkShareItems(NSArray *items, NSError **error) {
  NSMutableArray *result = [NSMutableArray array];
  for (NSDictionary *item in [items isKindOfClass:NSArray.class] ? items : @[]) {
    NSString *type = [item isKindOfClass:NSDictionary.class] ? item[@"type"] : nil;
    if ([type isEqual:@"text"] && Text(item[@"text"])) [result addObject:item[@"text"]];
    else if ([type isEqual:@"url"] && Text(item[@"url"]) && [NSURL URLWithString:item[@"url"]].scheme.length && ![NSURL URLWithString:item[@"url"]].isFileURL) [result addObject:[NSURL URLWithString:item[@"url"]]];
    else if ([type isEqual:@"file"] && Text(item[@"path"]) && [item[@"path"] hasPrefix:@"/"]) {
      if (![NSFileManager.defaultManager fileExistsAtPath:item[@"path"]]) {
        if (error) *error = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No file at %@", item[@"path"]]);
        return nil;
      }
      [result addObject:[NSURL fileURLWithPath:item[@"path"]]];
    } else {
      if (error) *error = Failure(@"E_INVALID_ARGUMENT", @"A share item is { type: text, text }, { type: url, url } (not a file URL) or { type: file, path } (absolute)");
      return nil;
    }
  }
  if (result.count == 0 && error) *error = Failure(@"E_INVALID_ARGUMENT", @"Expected at least one share item");
  return result.count ? result : nil;
}

NSDictionary<NSString *, NSDictionary *> *SparkDeclaredServices(NSDictionary *info) {
  NSMutableDictionary *services = [NSMutableDictionary dictionary];
  id declared = info[@"NSServices"];
  for (NSDictionary *entry in [declared isKindOfClass:NSArray.class] ? declared : @[])
    if ([entry isKindOfClass:NSDictionary.class] && [entry[@"NSMessage"] isEqual:SparkServiceMessage] && Text(entry[@"NSUserData"])) services[entry[@"NSUserData"]] = entry;
  return services;
}

NSDictionary *SparkSpotlightItem(id item, NSError **error) {
  NSDictionary *value = [item isKindOfClass:NSDictionary.class] ? item : nil;
  NSArray *keywords = value[@"keywords"];
  BOOL valid = value && Text(value[@"id"]) && Text(value[@"title"])
    && (!value[@"domain"] || Text(value[@"domain"])) && (!value[@"description"] || Text(value[@"description"]))
    && (!keywords || ([keywords isKindOfClass:NSArray.class] && [keywords indexOfObjectPassingTest:^BOOL(id keyword, NSUInteger, BOOL *) { return !Text(keyword); }] == NSNotFound))
    && (!value[@"expiresAt"] || ([value[@"expiresAt"] isKindOfClass:NSNumber.class] && isfinite([value[@"expiresAt"] doubleValue])));
  if (valid) return value;
  if (error) *error = Failure(@"E_INVALID_ARGUMENT", @"A Spotlight item has an id and title, and optional domain, description, keywords (strings) and expiresAt (Unix ms)");
  return nil;
}

static CSSearchableItem *SearchableItem(NSDictionary *item) {
  CSSearchableItemAttributeSet *attributes = [[CSSearchableItemAttributeSet alloc] initWithContentType:UTTypeItem];
  attributes.title = item[@"title"];
  attributes.contentDescription = item[@"description"];
  attributes.keywords = item[@"keywords"];
  CSSearchableItem *searchable = [[CSSearchableItem alloc] initWithUniqueIdentifier:item[@"id"] domainIdentifier:item[@"domain"] attributeSet:attributes];
  if (item[@"expiresAt"]) searchable.expirationDate = [NSDate dateWithTimeIntervalSince1970:[item[@"expiresAt"] doubleValue] / 1000];
  return searchable;
}

// Wraps a completion so it runs once, on the main thread, however often and wherever the system calls back.
static SparkSharingCompletion Once(SparkSharingCompletion completion) {
  __block SparkSharingCompletion pending = [completion copy];
  return ^(NSError *error) {
    dispatch_block_t finish = ^{
      SparkSharingCompletion callback = pending;
      pending = nil;
      if (callback) callback(error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}

@interface SparkSharing () <NSSharingServicePickerDelegate>
@end

@implementation SparkSharing {
  NSDictionary<NSString *, NSDictionary *> *_declared;
  NSMutableSet<NSString *> *_registered;
  NSSharingServicePicker *_picker;
  SparkShareCompletion _shared;
#if SPARK_TEST_DRIVER
  id _answer;
  NSMutableArray *_shares;
  NSMutableDictionary *_indexed;
  NSUInteger _invocations;
#endif
}

- (instancetype)initWithInfo:(NSDictionary *)info simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _declared = SparkDeclaredServices(info);
    _registered = [NSMutableSet set];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _declared = @{}; // The driver declares services (simulateAnswer:services:); Info.plist is never read.
      _answer = NSNull.null;
      _shares = [NSMutableArray array];
      _indexed = [NSMutableDictionary dictionary];
    }
#else
    NSAssert(!simulated, @"Simulated sharing exists only in builds with the test driver");
#endif
  }
  return self;
}

#pragma mark Share

- (void)share:(NSArray *)items view:(NSView *)view completion:(SparkShareCompletion)completion
{
  __block SparkShareCompletion pending = [completion copy];
  SparkShareCompletion done = ^(NSString *service, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{ SparkShareCompletion callback = pending; pending = nil; if (callback) callback(service, error); });
  };
  NSError *error = nil;
  NSArray *shareable = SparkShareItems(items, &error);
  if (!shareable) return done(nil, error);
  if (_shared) return done(nil, Failure(@"E_BUSY", @"A share picker is already open"));
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSString *service = [_answer isKindOfClass:NSString.class] && ![_answer isEqual:@"dismiss"] ? _answer : nil;
    [_shares addObject:@{ @"items": items, @"anchored": @(view != nil), @"service": service ?: NSNull.null }];
    if (_answer == NSNull.null) return done(nil, Failure(@"E_UNAVAILABLE", @"Test driver: no simulated share answer (simulateSharing shareAnswer)"));
    return done(service, nil);
  }
#endif
  NSView *anchor = view ?: (NSApp.keyWindow ?: NSApp.mainWindow).contentView;
  if (!anchor.window.isVisible) return done(nil, Failure(@"E_UNAVAILABLE", @"Sharing needs a visible window to show the picker from"));
  _shared = done;
  _picker = [[NSSharingServicePicker alloc] initWithItems:shareable];
  _picker.delegate = self;
  [_picker showRelativeToRect:anchor.bounds ofView:anchor preferredEdge:NSRectEdgeMinY];
}

// AppKit calls this once per picker: with the chosen service, or nil when the person dismissed it.
- (void)sharingServicePicker:(NSSharingServicePicker *)picker didChooseSharingService:(NSSharingService *)service
{
  if (picker != _picker) return;
  SparkShareCompletion done = _shared;
  _shared = nil;
  _picker = nil;
  if (done) done(service.title, nil);
}

#pragma mark Services

- (BOOL)registerService:(NSString *)name error:(NSError **)error
{
  NSDictionary *entry = _declared[name];
  NSError *failure = nil;
  if (!Text(name)) failure = Failure(@"E_INVALID_ARGUMENT", @"Expected a service name");
  else if (!entry) failure = Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Info.plist declares no service %@: add an NSServices entry with NSMessage sparkService and NSUserData %@", name, name]);
  else if ([entry[@"NSReturnTypes"] count]) failure = Failure(@"E_UNSUPPORTED_OPTION", [NSString stringWithFormat:@"Service %@ declares NSReturnTypes; Spark services only receive data", name]);
  else if ([_registered containsObject:name]) failure = Failure(@"E_BUSY", [NSString stringWithFormat:@"Service %@ already has a listener", name]);
  if (failure) { if (error) *error = failure; return NO; }
  [_registered addObject:name];
  if (!_simulated) NSApp.servicesProvider = self;
  return YES;
}

- (void)unregisterService:(NSString *)name
{
  [_registered removeObject:name];
  if (!_registered.count && !_simulated && NSApp.servicesProvider == self) NSApp.servicesProvider = nil;
}

- (void)sparkService:(NSPasteboard *)pasteboard userData:(NSString *)name error:(NSString **)message
{
  if (![_registered containsObject:name]) { *message = [NSString stringWithFormat:@"%@ is not available right now.", name]; return; }
  NSMutableArray *files = [NSMutableArray array], *urls = [NSMutableArray array];
  for (NSURL *url in [pasteboard readObjectsForClasses:@[NSURL.class] options:nil] ?: @[]) [url.isFileURL ? files : urls addObject:url.isFileURL ? url.path : url.absoluteString];
#if SPARK_TEST_DRIVER
  _invocations++;
#endif
  if (_serviceHandler) _serviceHandler(@{ @"name": name, @"text": [pasteboard stringForType:NSPasteboardTypeString] ?: NSNull.null, @"files": files, @"urls": urls });
}

#pragma mark Spotlight

- (void)index:(NSArray *)items completion:(SparkSharingCompletion)completion
{
  SparkSharingCompletion done = Once(completion);
  NSError *error = nil;
  if (![items isKindOfClass:NSArray.class] || !items.count) return done(Failure(@"E_INVALID_ARGUMENT", @"Expected at least one Spotlight item"));
  for (id item in items) if (!SparkSpotlightItem(item, &error)) return done(error);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    for (NSDictionary *item in items) _indexed[item[@"id"]] = item;
    return dispatch_async(dispatch_get_main_queue(), ^{ done(nil); });
  }
#endif
  if (!CSSearchableIndex.isIndexingAvailable) return done(Failure(@"E_UNAVAILABLE", @"Core Spotlight indexing is not available on this Mac"));
  NSMutableArray *searchable = [NSMutableArray array];
  for (NSDictionary *item in items) [searchable addObject:SearchableItem(item)];
  [CSSearchableIndex.defaultSearchableIndex indexSearchableItems:searchable completionHandler:^(NSError *failure) {
    done(failure ? Failure(@"E_NATIVE", [NSString stringWithFormat:@"Spotlight indexing failed: %@", failure.localizedDescription]) : nil);
  }];
}

- (void)deleteIdentifiers:(NSArray<NSString *> *)identifiers domains:(NSArray<NSString *> *)domains completion:(SparkSharingCompletion)completion
{
  SparkSharingCompletion done = Once(completion);
  NSArray *list = identifiers ?: domains;
  BOOL valid = !(identifiers && domains) && (!list || ([list isKindOfClass:NSArray.class] && list.count && [list indexOfObjectPassingTest:^BOOL(id value, NSUInteger, BOOL *) { return !Text(value); }] == NSNotFound));
  if (!valid) return done(Failure(@"E_INVALID_ARGUMENT", @"Delete Spotlight items by ids or by domains (non-empty strings), or all of them"));
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if (identifiers) [_indexed removeObjectsForKeys:identifiers];
    else if (domains) [_indexed removeObjectsForKeys:[_indexed keysOfEntriesPassingTest:^BOOL(id, NSDictionary *item, BOOL *) { return [domains containsObject:item[@"domain"] ?: @""]; }].allObjects];
    else [_indexed removeAllObjects];
    return dispatch_async(dispatch_get_main_queue(), ^{ done(nil); });
  }
#endif
  if (!CSSearchableIndex.isIndexingAvailable) return done(Failure(@"E_UNAVAILABLE", @"Core Spotlight indexing is not available on this Mac"));
  void (^handler)(NSError *) = ^(NSError *failure) {
    done(failure ? Failure(@"E_NATIVE", [NSString stringWithFormat:@"Deleting Spotlight items failed: %@", failure.localizedDescription]) : nil);
  };
  CSSearchableIndex *index = CSSearchableIndex.defaultSearchableIndex;
  if (identifiers) [index deleteSearchableItemsWithIdentifiers:identifiers completionHandler:handler];
  else if (domains) [index deleteSearchableItemsWithDomainIdentifiers:domains completionHandler:handler];
  else [index deleteAllSearchableItemsWithCompletionHandler:handler];
}

#if SPARK_TEST_DRIVER
#pragma mark Simulation

- (BOOL)simulateAnswer:(id)answer services:(NSArray<NSString *> *)services error:(NSError **)error
{
  NSError *failure = nil;
  if (!_simulated) failure = Failure(@"E_UNAVAILABLE", @"Sharing simulation needs the test driver");
  else if (answer && answer != NSNull.null && !Text(answer)) failure = Failure(@"E_INVALID_ARGUMENT", @"A simulated share answer is a service title, dismiss or null");
  else if (services && (![services isKindOfClass:NSArray.class] || [services indexOfObjectPassingTest:^BOOL(id name, NSUInteger, BOOL *) { return !Text(name); }] != NSNotFound))
    failure = Failure(@"E_INVALID_ARGUMENT", @"Simulated services are a list of names");
  if (failure) { if (error) *error = failure; return NO; }
  if (answer) _answer = answer;
  if (services) {
    NSMutableDictionary *declared = [NSMutableDictionary dictionary];
    for (NSString *name in services) declared[name] = @{ @"NSMessage": SparkServiceMessage, @"NSUserData": name, @"NSSendTypes": @[NSPasteboardTypeString] };
    _declared = declared;
  }
  return YES;
}

- (BOOL)invokeService:(NSString *)name text:(NSString *)text error:(NSError **)error
{
  NSError *failure = nil;
  if (!_simulated) failure = Failure(@"E_UNAVAILABLE", @"Sharing simulation needs the test driver");
  else if (![_registered containsObject:name]) failure = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:@"Service %@ has no listener", name]);
  else if (![text isKindOfClass:NSString.class]) failure = Failure(@"E_INVALID_ARGUMENT", @"invokeService needs text");
  if (failure) { if (error) *error = failure; return NO; }
  NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
  [pasteboard clearContents];
  [pasteboard setString:text forType:NSPasteboardTypeString];
  NSString *message = nil;
  [self sparkService:pasteboard userData:name error:&message];
  [pasteboard releaseGlobally];
  if (message) { if (error) *error = Failure(@"E_NATIVE", message); return NO; }
  return YES;
}

- (NSDictionary *)simulation
{
  return @{ @"shares": [_shares copy], @"indexed": [_indexed copy], @"services": [_declared.allKeys sortedArrayUsingSelector:@selector(compare:)],
    @"registered": [_registered.allObjects sortedArrayUsingSelector:@selector(compare:)], @"invocations": @(_invocations), @"answer": _answer };
}
#endif
@end
