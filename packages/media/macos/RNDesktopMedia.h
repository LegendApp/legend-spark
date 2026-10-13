#import <RNDesktopMediaSpec/RNDesktopMediaSpec.h>
#import <React/RCTInvalidating.h>
@class SparkCapture;
@interface RNDesktopMedia : NSObject <NativeDesktopMediaSpec, RCTInvalidating>
@end
// The process's capture instance (simulated in driver mode), shared by every runtime, RNDesktopCameraView and the test driver.
FOUNDATION_EXPORT SparkCapture *SparkMediaCapture(void);
