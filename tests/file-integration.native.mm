#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import "SparkFileIntegration.h"
#import "SparkDesktopError.h"
#import <sys/xattr.h>

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { fprintf(stderr, "FAIL: %s\n", message); failures++; } } while (0)
static NSString *Code(NSError *error) { return [error.domain isEqual:SparkFileIntegrationErrorDomain] ? error.userInfo[@"code"] : SparkDesktopErrorCode(error); }

// Runs inside the App Sandbox (the test signs a copy with sandbox entitlements).
static int Sandboxed(BOOL bookmarkEntitlement) {
  CHECK(SparkIsSandboxed(), "sandbox detected");
  NSError *error = nil;
  NSString *status = SparkFullDiskAccessStatus(SparkFullDiskAccessProbes(), SparkIsSandboxed(), &error);
  CHECK([status isEqual:@"indeterminate"], "sandboxed Full Disk Access is indeterminate, not denied");
  NSURL *file = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"sandboxed-bookmark.txt"]];
  [@"inside" writeToURL:file atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSData *bookmark = SparkCreateBookmark(file, NO, &error);
  if (!bookmarkEntitlement) {
    CHECK(!bookmark && [Code(error) isEqual:@"E_UNAVAILABLE"], "sandbox without the app-scope entitlement is E_UNAVAILABLE");
  } else {
    CHECK(bookmark.length > 0, error ? error.localizedDescription.UTF8String : "sandboxed bookmark created");
    BOOL stale = NO; NSURL *resolved = bookmark ? SparkResolveBookmark(bookmark, &stale, &error) : nil;
    CHECK([resolved.path isEqual:file.URLByResolvingSymlinksInPath.path] || [resolved.path isEqual:file.path], "sandboxed bookmark resolves");
    CHECK([resolved startAccessingSecurityScopedResource], "sandboxed security scope starts");
    [resolved stopAccessingSecurityScopedResource];
  }
  if (failures) return 1;
  printf("Sandboxed file integration tests passed\n");
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    if (!strcmp(argv[1], "--sandboxed")) return Sandboxed(YES);
    if (!strcmp(argv[1], "--sandboxed-without-bookmarks")) return Sandboxed(NO);
    NSString *root = @(argv[1]);
    NSFileManager *fm = NSFileManager.defaultManager;
    NSURL *file = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"note.txt"]];
    [@"hello" writeToURL:file atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSURL *missing = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"missing.txt"]];
    NSError *error = nil;

    // Bookmarks follow a rename and fail typed for malformed data or deleted targets.
    NSData *bookmark = SparkCreateBookmark(file, NO, &error);
    CHECK(bookmark.length > 0, "bookmark created");
    NSURL *renamed = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"renamed.txt"]];
    [fm moveItemAtURL:file toURL:renamed error:nil];
    BOOL stale = NO; NSURL *resolved = SparkResolveBookmark(bookmark, &stale, &error);
    CHECK([resolved.path.lastPathComponent isEqual:@"renamed.txt"], "bookmark tracks rename");
    CHECK([resolved startAccessingSecurityScopedResource], "security scope starts");
    [resolved stopAccessingSecurityScopedResource];
    [fm moveItemAtURL:renamed toURL:file error:nil];
    error = nil; CHECK(!SparkResolveBookmark([@"not a bookmark" dataUsingEncoding:NSUTF8StringEncoding], &stale, &error) && [Code(error) isEqual:@"E_INVALID_DATA"], "malformed bookmark is E_INVALID_DATA");
    NSURL *doomed = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"doomed.txt"]];
    [@"x" writeToURL:doomed atomically:YES encoding:NSUTF8StringEncoding error:nil];
    NSData *doomedBookmark = SparkCreateBookmark(doomed, YES, nil);
    [fm removeItemAtURL:doomed error:nil];
    error = nil; CHECK(!SparkResolveBookmark(doomedBookmark, &stale, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "deleted bookmark target is E_NOT_FOUND");

    // Full Disk Access probes distinguish TCC denial, grants and missing probes.
    NSString *readable = file.path;
    CHECK(!SparkIsSandboxed(), "unsandboxed process detected");
    error = nil; CHECK([SparkFullDiskAccessStatus(@[missing.path, readable], NO, &error) isEqual:@"granted"], "readable probe is granted");
    error = nil; CHECK(!SparkFullDiskAccessStatus(@[missing.path], NO, &error) && [Code(error) isEqual:@"E_UNAVAILABLE"], "no probe is E_UNAVAILABLE");
    error = nil; NSString *status = SparkFullDiskAccessStatus(SparkFullDiskAccessProbes(), NO, &error);
    CHECK([status isEqual:@"granted"] || [status isEqual:@"denied"], "system probe answers");
    if ([status isEqual:@"denied"]) CHECK([SparkFullDiskAccessStatus(SparkFullDiskAccessProbes(), YES, &error) isEqual:@"indeterminate"], "EPERM is indeterminate when sandboxed");
    printf("Full Disk Access for this process: %s\n", status.UTF8String ?: "error");

    // Extended attributes.
    error = nil; CHECK([SparkGetExtendedAttribute(file, @"so.legend.test", &error) isEqual:NSNull.null], "absent attribute is null");
    NSData *value = [NSData dataWithBytes:"\0\1\377" length:3];
    CHECK(SparkSetExtendedAttribute(file, @"so.legend.test", value, &error), "set attribute");
    CHECK([SparkGetExtendedAttribute(file, @"so.legend.test", &error) isEqual:value], "attribute round trips bytes");
    CHECK([SparkListExtendedAttributes(file, &error) containsObject:@"so.legend.test"], "attribute listed");
    CHECK(SparkRemoveExtendedAttribute(file, @"so.legend.test", &error) && SparkRemoveExtendedAttribute(file, @"so.legend.test", &error), "remove is idempotent");
    error = nil; CHECK(!SparkGetExtendedAttribute(missing, @"so.legend.test", &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "missing file attribute is E_NOT_FOUND");
    error = nil; CHECK(!SparkRemoveExtendedAttribute(missing, @"so.legend.test", &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "missing file removal is E_NOT_FOUND");
    error = nil; CHECK(!SparkSetExtendedAttribute(file, @"", value, &error) && [Code(error) isEqual:@"E_INVALID_ARGUMENT"], "empty attribute name rejected");

    // Quarantine.
    error = nil; CHECK([SparkGetQuarantine(file, &error) isEqual:NSNull.null], "unquarantined is null");
    CHECK(SparkSetQuarantine(file, @{ @"agentName": @"Spark", @"timestamp": @1700000000000 }, &error), "set quarantine");
    NSDictionary *quarantine = SparkGetQuarantine([NSURL fileURLWithPath:file.path], &error);
    CHECK([quarantine[@"agentName"] isEqual:@"Spark"] && [quarantine[@"timestamp"] doubleValue] == 1700000000000, "quarantine round trips");
    CHECK(getxattr(file.fileSystemRepresentation, "com.apple.quarantine", NULL, 0, 0, 0) > 0, "quarantine xattr written");
    CHECK(SparkClearQuarantine(file, &error) && SparkClearQuarantine(file, &error), "clear is idempotent");
    CHECK([SparkGetQuarantine(file, &error) isEqual:NSNull.null], "cleared quarantine is null");
    error = nil; CHECK(!SparkSetQuarantine(file, @{ @"dataURL": @"https://example.com/a" }, &error) && [Code(error) isEqual:@"E_UNSUPPORTED_OPTION"], "macOS rejects URLs it would discard");
    // Evidence for that rejection: LaunchServices accepts origin/data URLs and stores neither.
    NSDictionary *withURLs = @{ (__bridge NSString *)kLSQuarantineTypeKey: (__bridge NSString *)kLSQuarantineTypeWebDownload, (__bridge NSString *)kLSQuarantineAgentNameKey: @"Spark",
      (__bridge NSString *)kLSQuarantineOriginURLKey: [NSURL URLWithString:@"https://example.com/page"], (__bridge NSString *)kLSQuarantineDataURLKey: [NSURL URLWithString:@"https://example.com/file.zip"] };
    CHECK([file setResourceValue:withURLs forKey:NSURLQuarantinePropertiesKey error:&error], "LaunchServices accepts quarantine URLs");
    NSDictionary *stored = SparkGetQuarantine([NSURL fileURLWithPath:file.path], &error);
    CHECK([stored[@"agentName"] isEqual:@"Spark"] && !stored[@"originURL"] && !stored[@"dataURL"], "LaunchServices discards quarantine URLs; revisit setQuarantine if this fails");
    char raw[256] = {0}; getxattr(file.fileSystemRepresentation, "com.apple.quarantine", raw, sizeof raw - 1, 0, 0);
    CHECK(!strstr(raw, "example.com"), "quarantine xattr holds no URL");
    SparkClearQuarantine(file, &error);

    // Disk space.
    NSDictionary *space = SparkDiskSpace(file, &error);
    CHECK([space[@"totalBytes"] longLongValue] > 0 && [space[@"availableBytes"] longLongValue] >= 0 && [space[@"availableBytes"] longLongValue] <= [space[@"totalBytes"] longLongValue], "disk space bounds");
    error = nil; CHECK(!SparkDiskSpace(missing, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "missing disk space path is E_NOT_FOUND");

    // Applications, icons and thumbnails.
    NSArray *apps = SparkApplicationsForFile(file, &error);
    CHECK(apps.count > 0, "text file has applications");
    CHECK([[apps filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"isDefault == YES"]] count] == 1, "exactly one default application");
    error = nil; CHECK(!SparkApplicationURL(file.path, &error) && [Code(error) isEqual:@"E_INVALID_ARGUMENT"], "non-application rejected");
    CHECK(SparkApplicationURL(apps.firstObject[@"path"], &error) != nil, "listed application accepted");
    NSData *icon = SparkFileIconPNG(file, 64, &error);
    NSBitmapImageRep *iconImage = icon ? [NSBitmapImageRep imageRepWithData:icon] : nil;
    CHECK(iconImage.pixelsWide == 64 && iconImage.pixelsHigh == 64, "64px icon PNG");
    error = nil; CHECK(!SparkFileIconPNG(missing, 64, &error) && [Code(error) isEqual:@"E_NOT_FOUND"], "missing icon is E_NOT_FOUND");
    NSURL *image = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"image.png"]];
    NSBitmapImageRep *source = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:200 pixelsHigh:100 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    [[source representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToURL:image atomically:YES];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSData *thumbnail = nil; __block NSError *thumbnailError = nil;
    SparkThumbnailPNG(image, 128, ^(NSData *png, NSError *failure) { thumbnail = png; thumbnailError = failure; dispatch_semaphore_signal(done); });
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    NSBitmapImageRep *thumbnailImage = thumbnail ? [NSBitmapImageRep imageRepWithData:thumbnail] : nil;
    CHECK(thumbnailImage.pixelsWide <= 128 && thumbnailImage.pixelsWide > 0, thumbnailError ? thumbnailError.localizedDescription.UTF8String : "thumbnail fits");
    NSURL *opaque = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"data.sparkunknown"]];
    [[NSData dataWithBytes:"\0\1\2" length:3] writeToURL:opaque atomically:YES];
    thumbnail = nil; thumbnailError = nil;
    SparkThumbnailPNG(opaque, 128, ^(NSData *png, NSError *failure) { thumbnail = png; thumbnailError = failure; dispatch_semaphore_signal(done); });
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    CHECK(!thumbnail && [Code(thumbnailError) isEqual:@"E_UNAVAILABLE"], "unknown content has no thumbnail and no icon substitute");

    // Coordination runs the accessor and records moves.
    NSURL *moved = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"moved.txt"]];
    __block NSString *read = nil;
    CHECK(SparkCoordinate(SparkCoordinateRead, file, nil, &error, ^BOOL(NSURL *url, NSURL *to, NSError **failure) { read = [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:failure]; return read != nil; }) && [read isEqual:@"hello"], "coordinated read");
    CHECK(SparkCoordinate(SparkCoordinateMove, file, moved, &error, ^BOOL(NSURL *url, NSURL *to, NSError **failure) { return [fm moveItemAtURL:url toURL:to error:failure]; }) && [fm fileExistsAtPath:moved.path], "coordinated move");
    error = nil; CHECK(!SparkCoordinate(SparkCoordinateRead, missing, nil, &error, ^BOOL(NSURL *url, NSURL *to, NSError **failure) { return [NSData dataWithContentsOfURL:url options:0 error:failure] != nil; }) && [Code(error) isEqual:@"E_NOT_FOUND"], "coordinated failure keeps the accessor error");

    // Typed volume errors.
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSPOSIXErrorDomain code:EROFS userInfo:nil]) isEqual:@"E_READ_ONLY"], "EROFS");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSPOSIXErrorDomain code:ENOSPC userInfo:nil]) isEqual:@"E_NO_SPACE"], "ENOSPC");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSPOSIXErrorDomain code:EDQUOT userInfo:nil]) isEqual:@"E_NO_SPACE"], "EDQUOT");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteVolumeReadOnlyError userInfo:nil]) isEqual:@"E_READ_ONLY"], "Cocoa read-only");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteOutOfSpaceError userInfo:nil]) isEqual:@"E_NO_SPACE"], "Cocoa full");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteNoPermissionError userInfo:@{ NSUnderlyingErrorKey: [NSError errorWithDomain:NSPOSIXErrorDomain code:EROFS userInfo:nil] }]) isEqual:@"E_READ_ONLY"], "wrapped EROFS beats generic permission");
    CHECK([SparkDesktopErrorCode([NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteNoPermissionError userInfo:nil]) isEqual:@"E_PERMISSION"], "permission");
  }
  if (failures) return 1;
  printf("File integration tests passed\n");
  return 0;
}
