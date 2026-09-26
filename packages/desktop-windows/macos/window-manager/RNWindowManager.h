#import <React/RCTEventEmitter.h>
#import <RNDesktopWindowsSpec/RNDesktopWindowsSpec.h>

NS_ASSUME_NONNULL_BEGIN

@class NSWindow;

@interface RNWindowManager : RCTEventEmitter <NativeWindowManagerSpec>
+ (nullable NSWindow *)getMainWindow;
@end

NS_ASSUME_NONNULL_END
