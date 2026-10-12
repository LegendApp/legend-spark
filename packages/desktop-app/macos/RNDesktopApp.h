#import <RNDesktopAppSpec/RNDesktopAppSpec.h>
#import <React/RCTCallInvokerModule.h>
#import <React/RCTEventEmitter.h>
// The call invoker reaches this runtime's JS thread: the development profiler collects its samples there (SparkProfiler.mm).
@interface RNDesktopApp : RCTEventEmitter <NativeDesktopAppSpec, RCTCallInvokerModule>
@end
