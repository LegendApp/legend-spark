#import <Foundation/Foundation.h>

// The pod's only public header: the Swift App Intents that the Spark config plugin generates into the app target from
// macos.appIntents (`import RNDesktopAppIntents`; docs/app-intents.md#build) call into JavaScript through it.
NS_ASSUME_NONNULL_BEGIN

// The generated SparkGeneratedAppIntents class adopts this protocol: the pod finds it by name to donate intents, which only Swift
// can construct.
@protocol SparkAppIntentDonating <NSObject>
+ (void)donate:(NSString *)identifier parameters:(NSDictionary<NSString *, id> *)parameters completionHandler:(void (^)(NSError *_Nullable error))completionHandler;
@end

@interface SparkAppIntentsBridge : NSObject
// Runs the intent's JavaScript handler and completes once, with the text it returned (nil for intents that return
// none) or an error whose description the system shows. Any thread.
+ (void)performIntent:(NSString *)identifier parameters:(NSDictionary<NSString *, id> *)parameters completion:(void (^)(NSString *_Nullable text, NSError *_Nullable error))completion;
// Runs the entity's JavaScript query handler: `query` is { kind: "identifiers", identifiers }, { kind: "suggested" } or
// { kind: "search", text }. Completes once, with its entities ([{ id, title, subtitle? }]) or an error. Any thread.
+ (void)queryEntities:(NSString *)entity query:(NSDictionary<NSString *, id> *)query completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *_Nullable entities, NSError *_Nullable error))completion;
@end

NS_ASSUME_NONNULL_END
