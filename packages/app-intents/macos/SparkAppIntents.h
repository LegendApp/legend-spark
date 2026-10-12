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
// The Info.plist key the config plugin writes: [{ id, title, parameters: [{ name, title, type, optional }], returnsText }].
FOUNDATION_EXPORT NSString *const SparkAppIntentsInfoKey;
// The declarations an Info.plist lists, validated; nil (with E_INVALID_DATA) when they are malformed.
FOUNDATION_EXPORT NSArray<NSDictionary *> *_Nullable SparkAppIntentDeclarations(id value, NSError **error);

typedef void (^SparkAppIntentCompletion)(NSString *_Nullable text, NSError *_Nullable error);
typedef void (^SparkAppIntentsDone)(NSError *_Nullable error);
// Delivers an invocation to JavaScript: { requestId, id, parameters }.
typedef void (^SparkAppIntentDelivery)(NSDictionary *request);

// How long an invocation from the system waits for its handler's answer, from its start (seconds).
FOUNDATION_EXPORT const NSTimeInterval SparkAppIntentTimeout;

@interface SparkAppIntents : NSObject
// `declarations` from SparkAppIntentDeclarations. `unavailable`: why the system cannot run this app's intents (no
// declarations, no generated intents or no App Intents metadata in the build), nil when it can. `donor` is the
// generated class.
- (instancetype)initWithDeclarations:(NSArray<NSDictionary *> *)declarations unavailable:(nullable NSString *)unavailable donor:(nullable Class<SparkAppIntentDonating>)donor simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// Whether invocations can reach this app: compiled intents, or the simulation.
@property (nonatomic, readonly) BOOL available;
@property (nonatomic, readonly) NSArray<NSDictionary *> *declarations;
@property (nonatomic, copy, nullable) SparkAppIntentDelivery delivery;

// Takes the intent's invocations: E_UNAVAILABLE when the app has no compiled intents, E_NOT_FOUND for an undeclared
// id, E_BUSY when it already has a handler. Invocations waiting for it are delivered.
- (BOOL)registerHandler:(NSString *)identifier error:(NSError **)error;
// Releases the id; its delivered, unanswered invocations fail E_CLOSED. Invocations that arrive later wait for the next handler.
- (void)unregisterHandler:(NSString *)identifier;

// An invocation from the system (or the simulation): validates the parameters against the declaration, delivers it
// to the id's handler, or holds it until one registers (at most 20 wait, else E_BUSY), and completes once: with the
// handler's answer, or E_TIMEOUT after `timeout` seconds.
- (void)perform:(NSString *)identifier parameters:(NSDictionary *)parameters timeout:(NSTimeInterval)timeout completion:(SparkAppIntentCompletion)completion;
// A handler's answer: its text (nil when the intent returns none), or the error it failed with. E_CLOSED when the
// invocation already completed (it timed out or its handler was removed); E_INVALID_ARGUMENT when the text does not
// match the declaration (it then fails the invocation with E_INVALID_DATA).
- (BOOL)answer:(NSString *)requestId text:(nullable NSString *)text failure:(nullable NSError *)failure error:(NSError **)error;

// Offers the intent with these parameters to the system as something the person did (IntentDonationManager), which
// suggests it later. Validated like an invocation.
- (void)donate:(NSString *)identifier parameters:(NSDictionary *)parameters completion:(SparkAppIntentsDone)completion;

#if SPARK_TEST_DRIVER
// Simulated instances only: replaces the declared intents (validated as Info.plist's).
- (BOOL)simulateDeclarations:(id)declarations error:(NSError **)error;
// { declared: [ids], registered: [ids], invocations: [{ id, parameters, text?, error?: { code, message } }] (completed),
//   pending: n, donations: [{ id, parameters }] }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
