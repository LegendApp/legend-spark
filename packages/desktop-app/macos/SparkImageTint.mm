#import <AppKit/AppKit.h>
#import <objc/runtime.h>

// react-native-macos tints `Image` with a CISourceInCompositing filter on a sublayer, which a layer-hosting
// NSView never applies, so the tint covers the whole frame. Tint the image's opaque pixels instead, like
// UIKit's template rendering on iOS.
static const void *SparkSourceImageKey = &SparkSourceImageKey;

static NSImage *SparkTintedImage(NSImage *image, NSColor *tint) {
  CGImageRef source = [image CGImageForProposedRect:NULL context:nil hints:nil];
  if (!source) return image;
  size_t width = CGImageGetWidth(source), height = CGImageGetHeight(source);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, 0, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  if (!context) return image;
  CGRect rect = CGRectMake(0, 0, width, height);
  CGContextDrawImage(context, rect, source);
  CGContextSetBlendMode(context, kCGBlendModeSourceIn);
  CGContextSetFillColorWithColor(context, tint.CGColor);
  CGContextFillRect(context, rect);
  CGImageRef tinted = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  NSImage *result = [[NSImage alloc] initWithCGImage:tinted size:image.size];
  CGImageRelease(tinted);
  result.capInsets = image.capInsets;
  result.resizingMode = image.resizingMode;
  return result;
}

static void SparkShowImage(NSView *view, NSImage *image) {
  objc_setAssociatedObject(view, SparkSourceImageKey, image, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  NSColor *tint = [view valueForKey:@"tintColor"];
  NSImage *shown = image && tint ? SparkTintedImage(image, tint) : image;
  CALayer *layer = view.layer;
  if (shown && shown.resizingMode == NSImageResizingModeTile) {
    layer.contents = nil;
    layer.backgroundColor = [NSColor colorWithPatternImage:shown].CGColor;
  } else {
    layer.contents = shown;
    layer.backgroundColor = nil;
  }
}

@interface SparkImageTint : NSObject
@end

// A class, not a C constructor: static pods are linked with -ObjC, which keeps only object files with classes.
@implementation SparkImageTint
+ (void)load {
  Class type = NSClassFromString(@"RCTUIImageView");
  if (!type) return;
  class_replaceMethod(type, @selector(image), imp_implementationWithBlock(^NSImage *(NSView *view) {
    return objc_getAssociatedObject(view, SparkSourceImageKey);
  }), "@@:");
  class_replaceMethod(type, @selector(setImage:), imp_implementationWithBlock(^(NSView *view, NSImage *image) {
    SparkShowImage(view, image);
  }), "v@:@");
  Method setTint = class_getInstanceMethod(type, @selector(setTintColor:));
  if (!setTint) return;
  void (*original)(id, SEL, NSColor *) = (void (*)(id, SEL, NSColor *))method_getImplementation(setTint);
  method_setImplementation(setTint, imp_implementationWithBlock(^(NSView *view, NSColor *tint) {
    original(view, @selector(setTintColor:), tint);
    SparkShowImage(view, objc_getAssociatedObject(view, SparkSourceImageKey));
  }));
}
@end
