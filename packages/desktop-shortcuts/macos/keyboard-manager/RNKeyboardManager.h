#import <React/RCTEventEmitter.h>
#import <RNDesktopShortcutsSpec/RNDesktopShortcutsSpec.h>

NS_ASSUME_NONNULL_BEGIN

@class NSEvent;
FOUNDATION_EXPORT NSString *SparkKeyboardKeyString(NSEvent *event);

@interface RNKeyboardManager : RCTEventEmitter <NativeKeyboardManagerSpec>
@end

NS_ASSUME_NONNULL_END
