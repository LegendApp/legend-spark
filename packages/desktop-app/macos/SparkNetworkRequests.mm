#import "SparkNetworkRequests.h"
#import "SparkDesktop.h"
#import <stdatomic.h>

#if RCT_DEV
// NETWORK_INSPECTOR_MARKER (src/network-inspector/marker.ts) starts every id, so the release-safety probe (DEVT-REL-04)
// finds it in any binary that holds this reporting.
static NSString *const SparkNetworkInspectorMarker = @"spark-network-inspector";
// Negative while the inspector does not record.
static _Atomic NSInteger reportedBodySize = -1;
static _Atomic NSUInteger requestCount = 0;

void SparkSetNetworkReporting(NSInteger maxBodySize) {
  NSCAssert(NSThread.isMainThread, @"SparkSetNetworkReporting is main-thread confined");
  atomic_store(&reportedBodySize, maxBodySize);
}
// The first `max` bytes as base64, with the whole size, as the inspector's recorder takes a body.
static NSDictionary *Body(NSData *data, NSInteger max) {
  NSData *kept = data.length > (NSUInteger)max ? [data subdataWithRange:NSMakeRange(0, max)] : data;
  return @{ @"base64": [kept base64EncodedStringWithOptions:0], @"size": @(data.length) };
}
static void Report(NSDictionary *event) {
  dispatch_async(dispatch_get_main_queue(), ^{ SparkEmit(event); });
}
NSString *SparkNetworkRequestWillStart(NSString *module, NSURLRequest *request) {
  NSInteger max = atomic_load(&reportedBodySize);
  if (max < 0 || ![@[@"http", @"https"] containsObject:request.URL.scheme.lowercaseString ?: @""]) return nil;
  NSString *identifier = [NSString stringWithFormat:@"%@:native:%lu", SparkNetworkInspectorMarker, (unsigned long)atomic_fetch_add(&requestCount, 1) + 1];
  NSMutableDictionary *event = [@{ @"type": @"nativeNetwork", @"phase": @"request", @"id": identifier, @"module": module,
    @"method": request.HTTPMethod ?: @"GET", @"url": request.URL.absoluteString ?: @"", @"headers": request.allHTTPHeaderFields ?: @{} } mutableCopy];
  if (request.HTTPBody) event[@"body"] = Body(request.HTTPBody, max);
  Report(event);
  return identifier;
}
void SparkNetworkRequestDidEnd(NSString *identifier, NSURLResponse *response, NSData *data, NSError *error) {
  NSInteger max = atomic_load(&reportedBodySize);
  if (!identifier || max < 0) return;
  NSMutableDictionary *event = [@{ @"type": @"nativeNetwork", @"phase": @"end", @"id": identifier } mutableCopy];
  if (error) {
    event[@"error"] = error.localizedDescription ?: @"failed";
    event[@"canceled"] = @([error.domain isEqual:NSURLErrorDomain] && error.code == NSURLErrorCancelled);
  } else {
    if ([response isKindOfClass:NSHTTPURLResponse.class]) {
      event[@"status"] = @(((NSHTTPURLResponse *)response).statusCode);
      event[@"headers"] = ((NSHTTPURLResponse *)response).allHeaderFields;
    }
    if (response.URL) event[@"url"] = response.URL.absoluteString;
    if (data) event[@"body"] = Body(data, max);
  }
  Report(event);
}
#endif

void SparkLoadURL(NSString *module, NSURLRequest *request, void (^completion)(NSData *data, NSURLResponse *response, NSError *error)) {
#if RCT_DEV
  NSString *identifier = SparkNetworkRequestWillStart(module, request);
  void (^loaded)(NSData *, NSURLResponse *, NSError *) = completion;
  if (identifier) loaded = ^(NSData *data, NSURLResponse *response, NSError *error) {
    SparkNetworkRequestDidEnd(identifier, response, data, error);
    completion(data, response, error);
  };
  [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:loaded] resume];
#else
  [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:completion] resume];
#endif
}
