// React Native and Spark stubs for compiling the dialog modules into native test harnesses.
#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <memory>
#define RCT_EXPORT_MODULE(...)
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
static void RCTExecuteOnMainQueue(dispatch_block_t block) { block(); }
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeFileDialogSpecJSI : TurboModule { NativeFileDialogSpecJSI(ObjCTurboModule::InitParams const &) {} };
struct NativeDesktopMessageDialogSpecJSI : TurboModule { NativeDesktopMessageDialogSpecJSI(ObjCTurboModule::InitParams const &) {} };
}
@interface RNFileDialog : NSObject @end
@interface RNDesktopMessageDialog : NSObject @end
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
