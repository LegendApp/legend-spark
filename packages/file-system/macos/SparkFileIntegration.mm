#import "SparkFileIntegration.h"
#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <Quartz/Quartz.h>
#import <QuickLookThumbnailing/QuickLookThumbnailing.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <Security/Security.h>
#import <sys/xattr.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>
#import <pwd.h>
#import <errno.h>

NSString * const SparkFileIntegrationErrorDomain = @"SparkFileIntegration";
static NSError *Coded(NSString *code, NSString *message, NSError *cause = nil) {
  NSMutableDictionary *info = [@{ @"code": code, NSLocalizedDescriptionKey: message } mutableCopy];
  if (cause) info[NSUnderlyingErrorKey] = cause;
  return [NSError errorWithDomain:SparkFileIntegrationErrorDomain code:0 userInfo:info];
}
static NSError *Posix(int code) { return [NSError errorWithDomain:NSPOSIXErrorDomain code:code userInfo:nil]; }
static BOOL Fail(NSError **error, NSError *value) { if (error) *error = value; return NO; }
static BOOL Exists(NSURL *url, NSError **error) {
  struct stat info;
  if (lstat(url.fileSystemRepresentation, &info) == 0) return YES;
  return Fail(error, Posix(errno));
}

static BOOL Entitled(NSString *name) {
  SecTaskRef task = SecTaskCreateFromSelf(NULL);
  if (!task) return NO;
  CFTypeRef value = SecTaskCopyValueForEntitlement(task, (__bridge CFStringRef)name, NULL);
  CFRelease(task);
  BOOL entitled = value && CFEqual(value, kCFBooleanTrue);
  if (value) CFRelease(value);
  return entitled;
}
BOOL SparkIsSandboxed(void) {
  static BOOL sandboxed;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ sandboxed = Entitled(@"com.apple.security.app-sandbox"); });
  return sandboxed;
}
// Without the entitlement ScopedBookmarksAgent fails with an opaque NSFileReadUnknownError.
static BOOL BookmarksPermitted(NSError **error) {
  if (!SparkIsSandboxed() || Entitled(@"com.apple.security.files.bookmarks.app-scope")) return YES;
  return Fail(error, Coded(@"E_UNAVAILABLE", @"Sandboxed apps need the com.apple.security.files.bookmarks.app-scope entitlement for security-scoped bookmarks"));
}
NSData *SparkCreateBookmark(NSURL *url, BOOL readOnly, NSError **error) {
  if (!BookmarksPermitted(error)) return nil;
  NSURLBookmarkCreationOptions options = NSURLBookmarkCreationWithSecurityScope | (readOnly ? NSURLBookmarkCreationSecurityScopeAllowOnlyReadAccess : 0);
  return [url bookmarkDataWithOptions:options includingResourceValuesForKeys:nil relativeToURL:nil error:error];
}
NSURL *SparkResolveBookmark(NSData *data, BOOL *stale, NSError **error) {
  if (!BookmarksPermitted(error)) return nil;
  NSError *failure = nil;
  NSURL *url = [NSURL URLByResolvingBookmarkData:data options:NSURLBookmarkResolutionWithSecurityScope | NSURLBookmarkResolutionWithoutUI relativeToURL:nil bookmarkDataIsStale:stale error:&failure];
  if (url) return url;
  if ([failure.domain isEqual:NSCocoaErrorDomain] && failure.code == NSFileReadCorruptFileError) Fail(error, Coded(@"E_INVALID_DATA", @"Bookmark data is malformed", failure));
  else Fail(error, failure);
  return nil;
}

NSArray<NSString *> *SparkFullDiskAccessProbes(void) {
  struct passwd *user = getpwuid(getuid());
  NSString *home = user && user->pw_dir ? @(user->pw_dir) : NSHomeDirectory();
  // TCC-protected files that ordinary Unix permissions let the user read.
  return @[@"/Library/Application Support/com.apple.TCC/TCC.db",
    [home stringByAppendingPathComponent:@"Library/Application Support/com.apple.TCC/TCC.db"],
    [home stringByAppendingPathComponent:@"Library/Safari/Bookmarks.plist"]];
}
NSString *SparkFullDiskAccessStatus(NSArray<NSString *> *probes, BOOL sandboxed, NSError **error) {
  for (NSString *probe in probes) {
    int fd = open(probe.fileSystemRepresentation, O_RDONLY | O_CLOEXEC | O_NONBLOCK);
    if (fd >= 0) { close(fd); return @"granted"; }
    // Sandbox denials hide TCC's answer, and their errno varies by macOS release (EPERM, or
    // ENOENT for paths outside the container), so a sandboxed failure of any kind proves nothing.
    if (sandboxed) continue;
    if (errno == EPERM) return @"denied";
    if (errno != ENOENT && errno != ENOTDIR) { Fail(error, Posix(errno)); return nil; }
  }
  if (sandboxed) return @"indeterminate";
  Fail(error, Coded(@"E_UNAVAILABLE", @"No Full Disk Access probe exists on this system"));
  return nil;
}

static NSString *AppName(NSURL *app) {
  NSString *name = nil;
  [app getResourceValue:&name forKey:NSURLLocalizedNameKey error:nil];
  if (!name.length) name = app.lastPathComponent;
  return [name.pathExtension.lowercaseString isEqual:@"app"] ? name.stringByDeletingPathExtension : name;
}
NSArray<NSDictionary *> *SparkApplicationsForFile(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
  NSURL *preferred = [workspace URLForApplicationToOpenURL:url];
  NSMutableArray *result = [NSMutableArray new];
  NSMutableSet *seen = [NSMutableSet new];
  for (NSURL *app in [workspace URLsForApplicationsToOpenURL:url]) {
    NSString *path = app.URLByStandardizingPath.path;
    if ([seen containsObject:path]) continue;
    [seen addObject:path];
    [result addObject:@{ @"name": AppName(app), @"path": path, @"isDefault": @([path isEqual:preferred.URLByStandardizingPath.path]) }];
  }
  return result;
}
NSURL *SparkApplicationURL(NSString *path, NSError **error) {
  NSURL *app = [NSURL fileURLWithPath:path isDirectory:YES];
  if (!Exists(app, error)) return nil;
  NSString *type = nil;
  [app getResourceValue:&type forKey:NSURLTypeIdentifierKey error:nil];
  UTType *uti = type ? [UTType typeWithIdentifier:type] : nil;
  if (![uti conformsToType:UTTypeApplicationBundle]) { Fail(error, Coded(@"E_INVALID_ARGUMENT", @"Expected an application bundle")); return nil; }
  return app;
}

static NSData *PNG(CGImageRef image) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
  return [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}
NSData *SparkFileIconPNG(NSURL *url, NSInteger pixels, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSImage *icon = [NSWorkspace.sharedWorkspace iconForFile:url.path];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:pixels pixelsHigh:pixels bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  rep.size = NSMakeSize(pixels, pixels);
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = context;
  [icon drawInRect:NSMakeRect(0, 0, pixels, pixels) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];
  [context flushGraphics];
  [NSGraphicsContext restoreGraphicsState];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png) Fail(error, Coded(@"E_NATIVE", @"Could not encode the file icon"));
  return png;
}
void SparkThumbnailPNG(NSURL *url, NSInteger pixels, void (^completion)(NSData *, NSError *)) {
  NSError *missing = nil;
  if (!Exists(url, &missing)) { completion(nil, missing); return; }
  // Thumbnail only: never substitute the generic file icon for a missing preview.
  QLThumbnailGenerationRequest *request = [[QLThumbnailGenerationRequest alloc] initWithFileAtURL:url size:CGSizeMake(pixels, pixels) scale:1 representationTypes:QLThumbnailGenerationRequestRepresentationTypeThumbnail];
  [QLThumbnailGenerator.sharedGenerator generateBestRepresentationForRequest:request completionHandler:^(QLThumbnailRepresentation *thumbnail, NSError *failure) {
    if (!thumbnail) { completion(nil, Coded(@"E_UNAVAILABLE", @"No thumbnail is available for this file", failure)); return; }
    NSData *png = PNG(thumbnail.CGImage);
    completion(png, png ? nil : Coded(@"E_NATIVE", @"Could not encode the thumbnail"));
  }];
}

static BOOL ValidName(NSString *name, NSError **error) {
  if (name.length && strlen(name.UTF8String) <= XATTR_MAXNAMELEN && [name rangeOfString:@"\0"].location == NSNotFound) return YES;
  return Fail(error, Coded(@"E_INVALID_ARGUMENT", @"Invalid extended attribute name"));
}
NSArray<NSString *> *SparkListExtendedAttributes(NSURL *url, NSError **error) {
  const char *path = url.fileSystemRepresentation;
  for (;;) {
    ssize_t size = listxattr(path, NULL, 0, 0);
    if (size < 0) { Fail(error, Posix(errno)); return nil; }
    NSMutableData *buffer = [NSMutableData dataWithLength:size];
    ssize_t count = size ? listxattr(path, (char *)buffer.mutableBytes, size, 0) : 0;
    if (count < 0 && errno == ERANGE) continue;
    if (count < 0) { Fail(error, Posix(errno)); return nil; }
    NSMutableArray *names = [NSMutableArray new];
    const char *start = (const char *)buffer.bytes;
    for (ssize_t offset = 0; offset < count;) { NSString *name = @(start + offset); if (name) [names addObject:name]; offset += strlen(start + offset) + 1; }
    return [names sortedArrayUsingSelector:@selector(compare:)];
  }
}
id SparkGetExtendedAttribute(NSURL *url, NSString *name, NSError **error) {
  if (!ValidName(name, error)) return nil;
  const char *path = url.fileSystemRepresentation;
  for (;;) {
    ssize_t size = getxattr(path, name.UTF8String, NULL, 0, 0, 0);
    if (size < 0 && errno == ENOATTR) return NSNull.null;
    if (size < 0) { Fail(error, Posix(errno)); return nil; }
    NSMutableData *value = [NSMutableData dataWithLength:size];
    ssize_t count = size ? getxattr(path, name.UTF8String, value.mutableBytes, size, 0, 0) : 0;
    if (count < 0 && errno == ERANGE) continue;
    if (count < 0 && errno == ENOATTR) return NSNull.null;
    if (count < 0) { Fail(error, Posix(errno)); return nil; }
    value.length = count;
    return value;
  }
}
BOOL SparkSetExtendedAttribute(NSURL *url, NSString *name, NSData *value, NSError **error) {
  if (!ValidName(name, error)) return NO;
  if (setxattr(url.fileSystemRepresentation, name.UTF8String, value.bytes, value.length, 0, 0)) return Fail(error, Posix(errno));
  return YES;
}
BOOL SparkRemoveExtendedAttribute(NSURL *url, NSString *name, NSError **error) {
  if (!ValidName(name, error)) return NO;
  if (removexattr(url.fileSystemRepresentation, name.UTF8String, 0) == 0) return YES;
  if (errno == ENOATTR) return Exists(url, error);
  return Fail(error, Posix(errno));
}

id SparkGetQuarantine(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSDictionary *properties = nil;
  [url removeCachedResourceValueForKey:NSURLQuarantinePropertiesKey];
  if (![url getResourceValue:&properties forKey:NSURLQuarantinePropertiesKey error:error]) return nil;
  if (!properties) return NSNull.null;
  NSMutableDictionary *result = [NSMutableDictionary new];
  id agent = properties[(__bridge NSString *)kLSQuarantineAgentNameKey], origin = properties[(__bridge NSString *)kLSQuarantineOriginURLKey];
  id data = properties[(__bridge NSString *)kLSQuarantineDataURLKey], time = properties[(__bridge NSString *)kLSQuarantineTimeStampKey];
  if ([agent isKindOfClass:NSString.class]) result[@"agentName"] = agent;
  if ([origin isKindOfClass:NSURL.class]) result[@"originURL"] = [origin absoluteString];
  if ([data isKindOfClass:NSURL.class]) result[@"dataURL"] = [data absoluteString];
  if ([time isKindOfClass:NSDate.class]) result[@"timestamp"] = @(floor([time timeIntervalSince1970] * 1000));
  return result;
}
BOOL SparkSetQuarantine(NSURL *url, NSDictionary *info, NSError **error) {
  if (!Exists(url, error)) return NO;
  NSMutableDictionary *properties = [@{ (__bridge NSString *)kLSQuarantineTypeKey: (__bridge NSString *)kLSQuarantineTypeOtherDownload } mutableCopy];
  // LaunchServices accepts kLSQuarantineOriginURLKey/DataURLKey but stores neither in the xattr or
  // QuarantineEventsV2 (tests/file-integration.native.mm), so reject instead of dropping them.
  if (info[@"originURL"] || info[@"dataURL"]) return Fail(error, Coded(@"E_UNSUPPORTED_OPTION", @"macOS LaunchServices discards quarantine download URLs"));
  if ([info[@"agentName"] isKindOfClass:NSString.class]) properties[(__bridge NSString *)kLSQuarantineAgentNameKey] = info[@"agentName"];
  if ([info[@"timestamp"] isKindOfClass:NSNumber.class]) properties[(__bridge NSString *)kLSQuarantineTimeStampKey] = [NSDate dateWithTimeIntervalSince1970:[info[@"timestamp"] doubleValue] / 1000];
  return [url setResourceValue:properties forKey:NSURLQuarantinePropertiesKey error:error];
}
BOOL SparkClearQuarantine(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return NO;
  if (removexattr(url.fileSystemRepresentation, "com.apple.quarantine", 0) == 0 || errno == ENOATTR) return YES;
  return Fail(error, Posix(errno));
}

NSDictionary *SparkDiskSpace(NSURL *url, NSError **error) {
  if (!Exists(url, error)) return nil;
  NSDictionary *values = [url resourceValuesForKeys:@[NSURLVolumeTotalCapacityKey, NSURLVolumeAvailableCapacityKey, NSURLVolumeAvailableCapacityForImportantUsageKey] error:error];
  if (!values) return nil;
  NSNumber *total = values[NSURLVolumeTotalCapacityKey], *available = values[NSURLVolumeAvailableCapacityKey], *important = values[NSURLVolumeAvailableCapacityForImportantUsageKey];
  if (!total || !available) { Fail(error, Coded(@"E_UNAVAILABLE", @"The volume does not report its capacity")); return nil; }
  NSMutableDictionary *result = [@{ @"totalBytes": total, @"availableBytes": available } mutableCopy];
  if (important) result[@"macos"] = @{ @"importantUsageBytes": important };
  return result;
}

BOOL SparkCoordinate(SparkCoordination kind, NSURL *url, NSURL *to, NSError **error, BOOL (^accessor)(NSURL *, NSURL *, NSError **)) {
  NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  __block BOOL ok = NO; __block NSError *failure = nil; NSError *coordination = nil;
  if (kind == SparkCoordinateRead)
    [coordinator coordinateReadingItemAtURL:url options:0 error:&coordination byAccessor:^(NSURL *a) { NSError *e = nil; ok = accessor(a, nil, &e); failure = e; }];
  else if (kind == SparkCoordinateWrite || kind == SparkCoordinateDelete)
    [coordinator coordinateWritingItemAtURL:url options:kind == SparkCoordinateWrite ? NSFileCoordinatorWritingForReplacing : NSFileCoordinatorWritingForDeleting error:&coordination byAccessor:^(NSURL *a) { NSError *e = nil; ok = accessor(a, nil, &e); failure = e; }];
  else if (kind == SparkCoordinateCopy)
    [coordinator coordinateReadingItemAtURL:url options:0 writingItemAtURL:to options:NSFileCoordinatorWritingForReplacing error:&coordination byAccessor:^(NSURL *a, NSURL *b) { NSError *e = nil; ok = accessor(a, b, &e); failure = e; }];
  else
    [coordinator coordinateWritingItemAtURL:url options:NSFileCoordinatorWritingForMoving writingItemAtURL:to options:NSFileCoordinatorWritingForReplacing error:&coordination byAccessor:^(NSURL *a, NSURL *b) {
      NSError *e = nil; ok = accessor(a, b, &e); failure = e;
      if (ok) [coordinator itemAtURL:a didMoveToURL:b];
    }];
  if (coordination) return Fail(error, coordination);
  if (!ok) return Fail(error, failure ?: Coded(@"E_NATIVE", @"Coordinated file operation failed"));
  return YES;
}

// QLPreviewPanel asks the responder chain for a controller; Spark windows do not
// own one, so a single controller is inserted after the presenting window.
@interface SparkQuickLookController : NSResponder <QLPreviewPanelDataSource>
@property (copy) NSArray<NSURL *> *items;
@end
@implementation SparkQuickLookController
- (BOOL)acceptsPreviewPanelControl:(QLPreviewPanel *)panel { return self.items.count > 0; }
- (void)beginPreviewPanelControl:(QLPreviewPanel *)panel { panel.dataSource = self; }
- (void)endPreviewPanelControl:(QLPreviewPanel *)panel { if (panel.dataSource == self) panel.dataSource = nil; }
- (NSInteger)numberOfPreviewItemsInPreviewPanel:(QLPreviewPanel *)panel { return self.items.count; }
- (id<QLPreviewItem>)previewPanel:(QLPreviewPanel *)panel previewItemAtIndex:(NSInteger)index { return self.items[index]; }
@end
BOOL SparkShowQuickLook(NSArray<NSURL *> *urls, NSError **error) {
  NSCAssert(NSThread.isMainThread, @"Quick Look is main-thread confined");
  for (NSURL *url in urls) if (!Exists(url, error)) return NO;
  NSWindow *window = NSApp.mainWindow ?: NSApp.keyWindow;
  if (!window) for (NSWindow *candidate in NSApp.orderedWindows) if (candidate.isVisible && candidate.canBecomeMainWindow) { window = candidate; break; }
  if (!window) return Fail(error, Coded(@"E_UNAVAILABLE", @"Quick Look requires a visible app window"));
  static SparkQuickLookController *controller;
  if (!controller) controller = [SparkQuickLookController new];
  BOOL chained = NO;
  for (NSResponder *responder = window.nextResponder; responder; responder = responder.nextResponder) if (responder == controller) { chained = YES; break; }
  if (!chained) {
    // Detach from a previous window before joining this window's chain.
    for (NSWindow *other in NSApp.windows) if (other.nextResponder == controller) other.nextResponder = controller.nextResponder;
    controller.nextResponder = window.nextResponder;
    window.nextResponder = controller;
  }
  controller.items = urls;
  [NSApp activateIgnoringOtherApps:YES];
  [window makeKeyAndOrderFront:nil];
  QLPreviewPanel *panel = QLPreviewPanel.sharedPreviewPanel;
  [panel updateController];
  if (panel.dataSource != controller) return Fail(error, Coded(@"E_NATIVE", @"Quick Look did not accept the Spark preview controller"));
  [panel reloadData];
  panel.currentPreviewItemIndex = 0;
  [panel makeKeyAndOrderFront:nil];
  if (!panel.isVisible) return Fail(error, Coded(@"E_NATIVE", @"The Quick Look panel did not appear"));
  return YES;
}
