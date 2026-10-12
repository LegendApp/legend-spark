#import <AppKit/AppKit.h>

// The parts of @legendapp/spark/drag-drop that need no React Native: operation masks, dragging items (with promised
// files and custom images) and, in test driver builds only (SPARK_TEST_DRIVER, set by the RNDesktopDrag pod), a
// simulated dragging session for the test driver and native tests. Main thread only.
NS_ASSUME_NONNULL_BEGIN

// Operation names are copy, move and link. A move source also offers NSDragOperationGeneric, which the Command key
// selects, and a destination reads Generic as move.
FOUNDATION_EXPORT NSDragOperation SparkDragOperation(NSString *name);
FOUNDATION_EXPORT NSString *SparkDragOperationName(NSDragOperation operation);
FOUNDATION_EXPORT NSDragOperation SparkDragSourceMask(NSArray<NSString *> *names);
// The operation names a mask allows, in copy, move, link order.
FOUNDATION_EXPORT NSArray<NSString *> *SparkDragAllowedOperations(NSDragOperation mask);
// The first accepted operation the mask allows, or NSDragOperationNone.
FOUNDATION_EXPORT NSDragOperation SparkDragResolve(NSDragOperation mask, NSArray<NSString *> *accepted);
FOUNDATION_EXPORT NSPasteboardType SparkDragCustomType(NSString *mime);
// Built-in names (files, text, urls) and MIME types to pasteboard types.
FOUNDATION_EXPORT NSArray<NSPasteboardType> *SparkDragPasteboardTypes(NSArray<NSString *> *types);
FOUNDATION_EXPORT NSString *const SparkDragErrorDomain; // userInfo[@"code"] is a SparkError code

// Promised files: a file promise per request, written by the app (asynchronously) at the destination's path.
// `request` asks for a write; the app answers with -complete:error:. A request unanswered after `timeout` fails
// with E_TIMEOUT, reported through `failure`. Late or unknown answers are ignored.
@interface SparkPromisedFiles : NSObject <NSFilePromiseProviderDelegate>
- (instancetype)initWithTimeout:(NSTimeInterval)timeout request:(void (^)(NSInteger requestId, NSString *name, NSString *path))request
  failure:(void (^)(NSString *code, NSString *message))failure;
- (BOOL)complete:(NSInteger)requestId error:(nullable NSString *)message;
// Fails every pending write (the view went away).
- (void)cancelAll;
@property (readonly) NSUInteger pending;
@end

// The dragging items of a source ({files?, text?, urls?, data?, promisedFiles?: [{name, type?}]}), one per
// representation, each showing `image` ("view": a snapshot of `view`; {path, width, height}: an image file centered
// on `location`; nil: a document symbol described by `symbolDescription` at `location`). nil with an E_NOT_FOUND,
// E_UNAVAILABLE or E_INVALID_ARGUMENT error.
FOUNDATION_EXPORT NSArray<NSDraggingItem *> *_Nullable SparkDragItems(NSDictionary *source, id _Nullable image, NSView *view, NSPoint location,
  NSString *symbolDescription, SparkPromisedFiles *promises, NSError **error);

#if SPARK_TEST_DRIVER
// The mask a destination sees while modifiers are held, as AppKit documents the window server's narrowing
// (NSDraggingInfo draggingSourceOperationMask): Control keeps link, else Option keeps copy, else Command keeps generic.
FOUNDATION_EXPORT NSDragOperation SparkDragModifierMask(NSDragOperation mask, NSEventModifierFlags modifiers);

// A drag the window server would run, delivered in process: the items go on a private pasteboard, destinations get
// NSDraggingDestination and NSSpringLoadingDestination calls with this object as the dragging info, and dropping in a
// folder writes promised files there as Finder would. Spring loading activates after the system's springing delay.
@interface SparkSimulatedDrag : NSObject <NSDraggingInfo>
- (instancetype)initWithItems:(NSArray<NSDraggingItem *> *)items source:(id)source sourceMask:(NSDragOperation)mask ignoreModifiers:(BOOL)ignore;
@property (nonatomic) NSEventModifierFlags modifiers;
@property (nonatomic, readonly, nullable) NSView<NSDraggingDestination> *destination;
@property (nonatomic, readonly) NSUInteger springLoads; // activations so far
// Moves over `destination` (nil: over nothing), at its center. Returns the operation it accepts.
- (NSDragOperation)moveTo:(nullable NSView<NSDraggingDestination> *)destination;
// Drops on the current destination: the operation performed, or NSDragOperationNone.
- (NSDragOperation)drop;
- (void)cancel;
// Writes the items' promised files into `folder` as Finder does; `done` gets the written paths, or an error.
- (void)dropInFolder:(NSString *)folder done:(void (^)(NSArray<NSString *> *_Nullable paths, NSError *_Nullable error))done;
@end
#endif

NS_ASSUME_NONNULL_END
