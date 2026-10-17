#import <Foundation/Foundation.h>
#import "SparkAppIntentsBridge.h"

// App Intents for @legendapp/spark/app-intents (docs/app-intents.md). No React: tests/app-intents.native.mm drives it
// directly. Main thread only; every completion runs once, on the main thread.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: the driver
// declares the intents instead of Info.plist, invokes them as the system would, and donations are recorded instead
// of reaching the system.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkAppIntentsErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_NOT_FOUND, E_UNAVAILABLE, E_BUSY, E_CLOSED, E_TIMEOUT, E_NATIVE, or the
// code a handler failed with) of an error from this file.
FOUNDATION_EXPORT NSString *SparkAppIntentsErrorCode(NSError *error);
// The Info.plist keys the config plugin writes: SparkAppIntents is [{ id, title, parameters: [{ name, title, type,
// optional, default?, values? (type enum), entity? (type entity) }], returnsText }], SparkAppEntities [{ id, title }].
FOUNDATION_EXPORT NSString *const SparkAppIntentsInfoKey;
FOUNDATION_EXPORT NSString *const SparkAppEntitiesInfoKey;
// The declarations an Info.plist lists, validated; nil (with E_INVALID_DATA) when they are malformed.
FOUNDATION_EXPORT NSArray<NSDictionary *> *_Nullable SparkAppIntentDeclarations(id value, NSError **error);
FOUNDATION_EXPORT NSArray<NSDictionary *> *_Nullable SparkAppEntityDeclarations(id value, NSError **error);

// An intent's text (nil when it returns none), or an entity query's entities.
typedef void (^SparkAppIntentCompletion)(id _Nullable result, NSError *_Nullable error);
typedef void (^SparkAppIntentsDone)(NSError *_Nullable error);
// Delivers an invocation or entity query to JavaScript: { type: "appIntentInvoked", requestId, id, parameters } or
// { type: "appEntityQueried", requestId, entity, query }.
typedef void (^SparkAppIntentDelivery)(NSDictionary *request);
// Who a handler takes requests for: an intent's invocations, or an entity's queries.
typedef NS_ENUM(NSInteger, SparkAppIntentHandlerKind) { SparkAppIntentHandlerIntent, SparkAppIntentHandlerEntity };

// How long an invocation from the system waits for its handler's answer, from its start (seconds).
FOUNDATION_EXPORT const NSTimeInterval SparkAppIntentTimeout;

@interface SparkAppIntents : NSObject
// `declarations` from SparkAppIntentDeclarations, `entities` from SparkAppEntityDeclarations. `unavailable`: why the
// system cannot run this app's intents (no declarations, no generated intents or no App Intents metadata in the
// build), nil when it can. `donor` is the generated class.
- (instancetype)initWithDeclarations:(NSArray<NSDictionary *> *)declarations entities:(NSArray<NSDictionary *> *)entities unavailable:(nullable NSString *)unavailable donor:(nullable Class<SparkAppIntentDonating>)donor simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// Whether invocations can reach this app: compiled intents, or the simulation.
@property (nonatomic, readonly) BOOL available;
@property (nonatomic, readonly) NSArray<NSDictionary *> *declarations;
@property (nonatomic, copy, nullable) SparkAppIntentDelivery delivery;

// Takes the intent's invocations or the entity's queries: E_UNAVAILABLE when the app has no compiled intents,
// E_NOT_FOUND for an undeclared id, E_BUSY when it already has a handler. Requests waiting for it are delivered.
- (BOOL)registerHandler:(NSString *)identifier kind:(SparkAppIntentHandlerKind)kind error:(NSError **)error;
// Releases the id; its delivered, unanswered requests fail E_CLOSED. Requests that arrive later wait for the next handler.
- (void)unregisterHandler:(NSString *)identifier kind:(SparkAppIntentHandlerKind)kind;

// An invocation from the system (or the simulation): validates the parameters against the declaration (a missing one
// with a default gets it), delivers it to the id's handler, or holds it until one registers (at most 20 requests wait,
// else E_BUSY), and completes once: with the handler's answer, or E_TIMEOUT after `timeout` seconds.
- (void)perform:(NSString *)identifier parameters:(NSDictionary *)parameters timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion;
// An entity query from the system (or the simulation), held and completed as invocations are. `query` is
// { kind: "identifiers", identifiers: [string] }, { kind: "suggested" } or { kind: "search", text }.
- (void)query:(NSString *)entity query:(NSDictionary *)query timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion;
// A handler's answer: its result (an invocation's text, nil when the intent returns none; a query's entities, [{ id,
// title, subtitle? }]), or the error it failed with. E_CLOSED when the request already completed (it timed out or its
// handler was removed); E_INVALID_ARGUMENT when the result does not match the declaration (it then fails the request
// with E_INVALID_DATA).
- (BOOL)answer:(NSString *)requestId result:(nullable id)result failure:(nullable NSError *)failure error:(NSError **)error;

// Offers the intent with these parameters to the system as something the person did (IntentDonationManager), which
// suggests it later. Validated like an invocation.
- (void)donate:(NSString *)identifier parameters:(NSDictionary *)parameters completion:(SparkAppIntentsDone)completion;

#if SPARK_TEST_DRIVER
// Simulated instances only: replaces the declared intents or entities (validated as Info.plist's); nil keeps them.
- (BOOL)simulateDeclarations:(nullable id)declarations entities:(nullable id)entities error:(NSError **)error;
// { declared: [ids], registered: [ids], entities: [ids], registeredEntities: [ids], invocations: [{ id, parameters,
//   text?, error?: { code, message } }] and queries: [{ entity, query, entities?, error? }] (completed), pending: n
//   (invocations and queries), donations: [{ id, parameters }] }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
