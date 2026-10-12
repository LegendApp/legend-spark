#import <Foundation/Foundation.h>
#import <mach-o/loader.h>

NS_ASSUME_NONNULL_BEGIN

// Stack walking and frame description shared by the hang watchdog and the crash reporter.

/** Frames the walkers record at most. */
static const size_t SparkMaxFrames = 128;

/**
 * Walks the frame-pointer chain from a thread's registers into `frames` (innermost first) and returns
 * the count. Only reads memory through vm_read_overwrite into the caller's buffer: no allocation, no
 * lock, so it is safe in a signal handler and while the walked thread is suspended. On arm64 a leaf
 * function's caller is only in the link register: `*linkFrame` is the index of the frame taken from
 * it, or SIZE_MAX. Pointer authentication bits are removed.
 */
FOUNDATION_EXPORT size_t SparkWalkStack(uintptr_t pc, uintptr_t fp, uintptr_t lr, uintptr_t *frames, size_t capacity, size_t *linkFrame);

/** The image's LC_UUID as 16 bytes; NO when it has none. Reads only the mapped header, so it is safe in a dyld callback. */
FOUNDATION_EXPORT BOOL SparkImageUUIDBytes(const struct mach_header_64 *header, uint8_t uuid[_Nonnull 16]);
FOUNDATION_EXPORT NSString *_Nullable SparkImageUUID(const struct mach_header_64 *header);
FOUNDATION_EXPORT NSString *SparkHex(uintptr_t value);

/**
 * Adds `symbol` and `symbolOffset` for an address in this process, from the symbols the dynamic
 * loader knows (dladdr). A return address (`returnAddress`) is looked up one byte back, at its call.
 */
FOUNDATION_EXPORT void SparkAddSymbol(NSMutableDictionary *frame, uintptr_t address, BOOL returnAddress);

/** Whether a link-register frame is a stale return address inside the running function rather than its caller. */
FOUNDATION_EXPORT BOOL SparkIsStaleLinkFrame(uintptr_t link, uintptr_t running);

/**
 * Frames of this process as reports carry them: { address, image?, imageAddress?, imageOffset?, imageUUID?,
 * symbol?, symbolOffset? }. A stale link-register frame is left out.
 */
FOUNDATION_EXPORT NSArray<NSDictionary *> *SparkSymbolicate(const uintptr_t *frames, size_t count, size_t linkFrame);

NS_ASSUME_NONNULL_END
