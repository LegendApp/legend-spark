#import "RNDesktopClipboard.h"
#import <RNDesktopApp/SparkBinaryJSI.h>
#import <RNDesktopApp/SparkDesktop.h>
@implementation RNDesktopClipboard
RCT_EXPORT_MODULE(NativeDesktopClipboard)
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { [self perform:method args:SparkArgs(json) binary:NO resolve:resolve reject:reject]; }
- (void)binaryCall:(NSString *)method args:(NSString *)json bytes:(NSData *)bytes resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { NSMutableDictionary *args = [SparkArgs(json) mutableCopy]; if (bytes) args[@"imagePNG"] = bytes; [self perform:method args:args binary:YES resolve:resolve reject:reject]; }
- (void)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    if ([method isEqual:@"hasString"]) {
      resolve(SparkJSON(@([board availableTypeFromArray:@[NSPasteboardTypeString, NSPasteboardTypeHTML, NSPasteboardTypeRTF]] != nil))); return;
    }
    if ([method isEqual:@"getString"] || [method isEqual:@"setString"]) {
      NSString *format = args[@"format"];
      if (![@[@"plainText", @"html"] containsObject:format]) { SparkInvalid(reject, @"Invalid clipboard string format"); return; }
      BOOL html = [format isEqual:@"html"];
      if ([method isEqual:@"setString"]) {
        NSString *text = args[@"text"];
        if (![text isKindOfClass:NSString.class]) { SparkInvalid(reject, @"Expected clipboard text"); return; }
        NSPasteboardItem *item = [NSPasteboardItem new];
        [item setString:text forType:html ? NSPasteboardTypeHTML : NSPasteboardTypeString];
        if (html) {
          NSAttributedString *rich = [[NSAttributedString alloc] initWithData:[text dataUsingEncoding:NSUTF8StringEncoding]
            options:@{NSDocumentTypeDocumentAttribute: NSHTMLTextDocumentType, NSCharacterEncodingDocumentAttribute: @(NSUTF8StringEncoding)} documentAttributes:nil error:nil];
          if (rich) [item setString:rich.string forType:NSPasteboardTypeString];
        }
        [board clearContents];
        if (![board writeObjects:@[item]]) { reject(@"E_CLIPBOARD", @"Could not write clipboard", nil); return; }
        resolve(@"null"); return;
      }
      NSString *text = [board stringForType:html ? NSPasteboardTypeHTML : NSPasteboardTypeString];
      if (!text) {
        NSString *sourceType = [board availableTypeFromArray:@[NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeString]];
        NSData *data = sourceType ? [board dataForType:sourceType] : nil;
        NSString *documentType = [sourceType isEqual:NSPasteboardTypeHTML] ? NSHTMLTextDocumentType :
          [sourceType isEqual:NSPasteboardTypeRTF] ? NSRTFTextDocumentType : NSPlainTextDocumentType;
        NSAttributedString *rich = data ? [[NSAttributedString alloc] initWithData:data
          options:@{NSDocumentTypeDocumentAttribute: documentType, NSCharacterEncodingDocumentAttribute: @(NSUTF8StringEncoding)} documentAttributes:nil error:nil] : nil;
        if (html && rich) {
          NSData *encoded = [rich dataFromRange:NSMakeRange(0, rich.length) documentAttributes:@{NSDocumentTypeDocumentAttribute: NSHTMLTextDocumentType} error:nil];
          text = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
        } else text = rich.string;
      }
      resolve(SparkJSON(text ?: @"")); return;
    }
    if ([method isEqual:@"formats"]) { resolve(SparkJSON(board.types ?: @[])); return; }
    if ([method isEqual:@"clear"]) { [board clearContents]; resolve(@"null"); return; }
    NSDictionary *types = @{ @"text": NSPasteboardTypeString, @"html": NSPasteboardTypeHTML, @"rtf": NSPasteboardTypeRTF };
    if ([method isEqual:@"read"]) {
      NSMutableDictionary *content = [NSMutableDictionary new];
      for (NSString *key in types) { NSString *value = [board stringForType:types[key]]; if (value) content[key] = value; }
      NSData *image = [board dataForType:NSPasteboardTypePNG];
      if (!image) { NSData *tiff = [board dataForType:NSPasteboardTypeTIFF]; if (tiff) image = [[NSBitmapImageRep imageRepWithData:tiff] representationUsingType:NSBitmapImageFileTypePNG properties:@{}]; }
      if (image) content[@"imagePNG"] = image;
      NSArray *urls = [board readObjectsForClasses:@[NSURL.class] options:@{ NSPasteboardURLReadingFileURLsOnlyKey: @YES }];
      if (urls.count) content[@"files"] = [urls valueForKey:@"path"];
      resolve(binary ? content : SparkJSON(content)); return;
    }
    if ([method isEqual:@"write"]) {
      NSMutableArray *objects = [NSMutableArray new];
      if (args[@"files"]) for (NSString *file in args[@"files"]) [objects addObject:[NSURL fileURLWithPath:file]];
      else {
        NSPasteboardItem *item = [NSPasteboardItem new];
        for (NSString *key in types) if (args[key]) [item setString:args[key] forType:types[key]];
        if (args[@"imagePNG"]) {
          NSData *image = args[@"imagePNG"];
          if (!image || ![NSBitmapImageRep imageRepWithData:image]) { SparkInvalid(reject, @"Invalid clipboard image"); return; }
          [item setData:image forType:NSPasteboardTypePNG];
        }
        if (item.types.count) [objects addObject:item];
      }
      [board clearContents]; if (objects.count && ![board writeObjects:objects]) { reject(@"E_CLIPBOARD", @"Could not write clipboard", nil); return; }
      resolve(@"null"); return;
    }
    SparkInvalid(reject, @"Unknown clipboard operation");
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<spark::binary::Module<facebook::react::NativeDesktopClipboardSpecJSI>>(params);
}
@end
