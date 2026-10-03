#import <Foundation/Foundation.h>
#import <errno.h>

static inline NSString *SparkDesktopErrorCode(NSError *error) {
  NSString *code = @"E_IO";
  if ([error.domain isEqualToString:NSCocoaErrorDomain]) {
    if (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError) return @"E_NOT_FOUND";
    if (error.code == NSFileReadNoPermissionError || error.code == NSFileWriteNoPermissionError) return @"E_PERMISSION";
    if (error.code == NSFileWriteFileExistsError) return @"E_EXISTS";
    if (error.code == NSFileWriteInvalidFileNameError) return @"E_INVALID_ARGUMENT";
  }
  if ([error.domain isEqualToString:NSPOSIXErrorDomain]) {
    if (error.code == ENOENT || error.code == ENOTDIR) return @"E_NOT_FOUND";
    if (error.code == EACCES || error.code == EPERM) return @"E_PERMISSION";
    if (error.code == EEXIST) return @"E_EXISTS";
    if (error.code == EINVAL) return @"E_INVALID_ARGUMENT";
    if (error.code == ENOTEMPTY) return @"E_NOT_EMPTY";
  }
  return code;
}
