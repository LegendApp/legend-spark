#include "dialog-native-prelude.h"
// ACTUAL_IMPLEMENTATION
// Configures real AppKit panels and alerts through the modules' builders and inspects them.
// Nothing is presented: no panel runs, no window is ordered front, and the app never activates.
static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)

// Setting a panel's accessoryView makes AppKit host it in an NSAccessoryViewWindow ordered in
// outside every screen. No other window may be ordered in, and none may overlap a screen.
static BOOL Offscreen() {
  for (NSWindow *window in NSApp.windows) {
    if (!window.visible) continue;
    if (![NSStringFromClass(window.class) isEqual:@"NSAccessoryViewWindow"]) return NO;
    for (NSScreen *screen in NSScreen.screens) if (NSIntersectsRect(window.frame, screen.frame)) return NO;
  }
  return YES;
}
static BOOL Contains(NSView *ancestor, NSView *view) { for (NSView *current = view; current; current = current.superview) if (current == ancestor) return YES; return NO; }
static NSString *JSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil] encoding:NSUTF8StringEncoding]; }

// Renders a view at 2x into a PNG with cacheDisplayInRect, as the test driver captures windows.
static void Render(NSView *view, NSString *directory, NSString *name) {
  if (!directory) return;
  [view layoutSubtreeIfNeeded];
  NSRect bounds = view.bounds;
  if (NSIsEmptyRect(bounds)) { fprintf(stderr, "EMPTY %s\n", name.UTF8String); failures++; return; }
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)(bounds.size.width * 2) pixelsHigh:(NSInteger)(bounds.size.height * 2) bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  rep.size = bounds.size;
  [view cacheDisplayInRect:bounds toBitmapImageRep:rep];
  NSString *path = [directory stringByAppendingPathComponent:[name stringByAppendingPathExtension:@"png"]];
  CHECK([[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES]);
}
// An offscreen window supplies the window background behind an accessory view. It is never shown.
static void RenderAccessory(NSView *accessory, NSString *appearance, NSString *directory, NSString *name) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, MAX(accessory.frame.size.width, 420), accessory.frame.size.height) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  window.releasedWhenClosed = NO;
  window.appearance = [NSAppearance appearanceNamed:appearance];
  accessory.frame = window.contentView.bounds;
  accessory.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [window.contentView addSubview:accessory];
  Render(window.contentView.superview, directory, name);
  [accessory removeFromSuperview];
}
static void RenderAlert(NSAlert *alert, NSString *appearance, NSString *directory, NSString *name) {
  alert.window.appearance = [NSAppearance appearanceNamed:appearance];
  [alert layout];
  Render(alert.window.contentView.superview, directory, name);
}

static NSArray *Accessory(NSString *checkbox, NSString *format, NSArray<NSString *> *labels) {
  return @[
    @{ @"type": @"popup", @"id": @"format", @"label": format, @"options": @[@{ @"value": @"txt", @"label": labels[0] }, @{ @"value": @"md", @"label": labels[1] }, @{ @"value": @"json", @"label": labels[2] }], @"value": @"md" },
    @{ @"type": @"checkbox", @"id": @"metadata", @"label": checkbox, @"checked": @YES },
  ];
}

int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSString *output = argc > 1 ? @(argv[1]) : nil;
  RNFileDialog *files = [RNFileDialog new];
  NSArray *accessory = Accessory(@"Include metadata", @"Format:", @[@"Plain text", @"Markdown", @"JSON"]);

  // Open panel: base options plus a disclosed accessory whose controls report their values.
  NSOpenPanel *open = [NSOpenPanel openPanel];
  NSDictionary *openControls = [RNFileDialog configureOpenPanel:open options:@{ @"title": @"Import", @"message": @"Choose notes", @"prompt": @"Import", @"allowedFileTypes": @[@"txt"], @"canChooseFiles": @YES, @"accessory": accessory }];
  CHECK([open.title isEqual:@"Import"] && [open.message isEqual:@"Choose notes"] && [open.prompt isEqual:@"Import"]);
  CHECK(open.accessoryView && open.accessoryViewDisclosed);
  NSPopUpButton *format = (NSPopUpButton *)openControls[@"format"];
  NSButton *metadata = (NSButton *)openControls[@"metadata"];
  CHECK([format isKindOfClass:NSPopUpButton.class] && [metadata isKindOfClass:NSButton.class]);
  CHECK(Contains(open.accessoryView, format) && Contains(open.accessoryView, metadata));
  CHECK([format.itemTitles isEqual:(@[@"Plain text", @"Markdown", @"JSON"])] && format.indexOfSelectedItem == 1);
  CHECK([metadata.title isEqual:@"Include metadata"] && metadata.state == NSControlStateValueOn);
  CHECK([format.accessibilityIdentifier isEqual:@"format"] && [metadata.accessibilityIdentifier isEqual:@"metadata"] && [format.accessibilityLabel isEqual:@"Format:"]);
  CHECK([JSON(SparkAccessoryValues(accessory, openControls)) isEqual:@"{\"format\":\"md\",\"metadata\":true}"]);
  [format selectItemAtIndex:2]; metadata.state = NSControlStateValueOff;
  CHECK([JSON([files selection:@[@"/tmp/a.txt"] key:@"paths" options:@{ @"accessory": accessory } controls:openControls]) isEqual:@"{\"accessory\":{\"format\":\"json\",\"metadata\":false},\"paths\":[\"\\/tmp\\/a.txt\"]}"]);
  CHECK([[files selection:@[@"/tmp/a.txt"] key:@"paths" options:@{} controls:@{}] isEqual:@[@"/tmp/a.txt"]]);

  // Save panel: the accessory sits below the name field; no accessory leaves the panel untouched.
  NSSavePanel *save = [NSSavePanel savePanel];
  NSDictionary *saveControls = [RNFileDialog configureSavePanel:save options:@{ @"defaultName": @"Notes.md", @"accessory": accessory }];
  CHECK([save.nameFieldStringValue isEqual:@"Notes.md"] && save.accessoryView && saveControls.count == 2);
  CHECK([JSON([files selection:@"/tmp/Notes.md" key:@"path" options:@{ @"accessory": accessory } controls:saveControls]) isEqual:@"{\"accessory\":{\"format\":\"md\",\"metadata\":true},\"path\":\"\\/tmp\\/Notes.md\"}"]);
  NSSavePanel *plain = [NSSavePanel savePanel];
  CHECK([RNFileDialog configureSavePanel:plain options:@{}].count == 0 && !plain.accessoryView);

  // Suppression checkbox: AppKit's suppression button with the caller's label and state.
  NSDictionary *suppressArgs = @{ @"title": @"Empty the Trash?", @"message": @"Items are deleted immediately.", @"kind": @"warning", @"buttons": @[@"Empty Trash", @"Cancel"], @"defaultButton": @0, @"cancelButton": @1, @"checkbox": @{ @"label": @"Don't ask again", @"checked": @NO } };
  NSAlert *suppress = [RNDesktopMessageDialog alertWithArgs:suppressArgs];
  CHECK(suppress.showsSuppressionButton && [suppress.suppressionButton.title isEqual:@"Don't ask again"] && suppress.suppressionButton.state == NSControlStateValueOff);
  CHECK(suppress.alertStyle == NSAlertStyleWarning && suppress.buttons.count == 2);
  CHECK([suppress.buttons[0].keyEquivalent isEqual:@"\r"] && [suppress.buttons[1].keyEquivalent isEqual:@"\033"]);
  CHECK(!suppress.accessoryView);
  NSAlert *checked = [RNDesktopMessageDialog alertWithArgs:@{ @"title": @"Checked", @"buttons": @[@"OK"], @"checkbox": @{ @"label": @"Remember", @"checked": @YES } }];
  CHECK(checked.suppressionButton.state == NSControlStateValueOn);
  CHECK(![RNDesktopMessageDialog alertWithArgs:@{ @"title": @"Plain", @"buttons": @[@"OK"] }].showsSuppressionButton);

  // Prompts: a plain or secure text field accessory that receives focus, with Return and Escape buttons.
  NSDictionary *promptArgs = @{ @"title": @"Rename document", @"message": @"Enter a new name.", @"buttons": @[@"Rename", @"Cancel"], @"defaultButton": @0, @"cancelButton": @1, @"input": @{ @"placeholder": @"Name", @"defaultValue": @"Untitled", @"secure": @NO } };
  NSAlert *prompt = [RNDesktopMessageDialog alertWithArgs:promptArgs];
  NSTextField *field = (NSTextField *)prompt.accessoryView;
  CHECK([field isKindOfClass:NSTextField.class] && ![field isKindOfClass:NSSecureTextField.class]);
  CHECK([field.stringValue isEqual:@"Untitled"] && [field.placeholderString isEqual:@"Name"] && field.editable);
  CHECK(prompt.window.initialFirstResponder == field && [field.accessibilityLabel isEqual:@"Rename document"]);
  CHECK([prompt.buttons[0].keyEquivalent isEqual:@"\r"] && [prompt.buttons[1].keyEquivalent isEqual:@"\033"]);
  NSAlert *secure = [RNDesktopMessageDialog alertWithArgs:@{ @"title": @"Unlock", @"buttons": @[@"Unlock", @"Cancel"], @"defaultButton": @0, @"cancelButton": @1, @"input": @{ @"defaultValue": @"", @"secure": @YES } }];
  CHECK([secure.accessoryView isKindOfClass:NSSecureTextField.class] && ((NSTextField *)secure.accessoryView).placeholderString == nil);

  // About panel: overrides map to AppKit's option keys; omitted keys keep the bundle's values.
  NSString *icon = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-about-%d.png", getpid()]];
  NSImage *image = [NSImage imageWithSize:NSMakeSize(16, 16) flipped:NO drawingHandler:^BOOL(NSRect rect) { [NSColor.systemBlueColor setFill]; NSRectFill(rect); return YES; }];
  [[[NSBitmapImageRep imageRepWithData:image.TIFFRepresentation] representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:icon atomically:YES];
  NSString *code = nil, *message = nil;
  NSDictionary *about = [RNDesktopMessageDialog aboutPanelOptions:@{ @"name": @"Spark Notes", @"version": @"2.1", @"build": @"421", @"copyright": @"© 2026 Legend", @"credits": @"Made with Spark", @"iconPath": icon } code:&code message:&message];
  CHECK([about[NSAboutPanelOptionApplicationName] isEqual:@"Spark Notes"] && [about[NSAboutPanelOptionApplicationVersion] isEqual:@"2.1"] && [about[NSAboutPanelOptionVersion] isEqual:@"421"] && [about[@"Copyright"] isEqual:@"© 2026 Legend"]);
  CHECK([[about[NSAboutPanelOptionCredits] string] isEqual:@"Made with Spark"] && [about[NSAboutPanelOptionApplicationIcon] isKindOfClass:NSImage.class]);
  CHECK([[RNDesktopMessageDialog aboutPanelOptions:@{} code:&code message:&message] count] == 0);
  CHECK(![RNDesktopMessageDialog aboutPanelOptions:@{ @"iconPath": @"/nonexistent/spark-icon.png" } code:&code message:&message] && [code isEqual:@"E_NOT_FOUND"]);
  NSString *notImage = [icon stringByAppendingString:@".txt"]; [@"text" writeToFile:notImage atomically:YES encoding:NSUTF8StringEncoding error:nil];
  CHECK(![RNDesktopMessageDialog aboutPanelOptions:@{ @"iconPath": notImage } code:&code message:&message] && [code isEqual:@"E_INVALID_DATA"]);
  [NSFileManager.defaultManager removeItemAtPath:icon error:nil]; [NSFileManager.defaultManager removeItemAtPath:notImage error:nil];

  // Nothing was presented.
  CHECK(Offscreen());
  CHECK(!NSApp.active && !NSApp.modalWindow);

  if (output) {
    for (NSString *appearance in @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]) {
      NSString *suffix = appearance == NSAppearanceNameAqua ? @"light" : @"dark";
      RenderAccessory(SparkAccessoryView(accessory, [NSMutableDictionary new]), appearance, output, [@"save-accessory-" stringByAppendingString:suffix]);
      RenderAlert([RNDesktopMessageDialog alertWithArgs:suppressArgs], appearance, output, [@"alert-suppression-" stringByAppendingString:suffix]);
      RenderAlert([RNDesktopMessageDialog alertWithArgs:promptArgs], appearance, output, [@"prompt-" stringByAppendingString:suffix]);
      RenderAlert([RNDesktopMessageDialog alertWithArgs:@{ @"title": @"Unlock vault", @"message": @"Enter the vault password.", @"buttons": @[@"Unlock", @"Cancel"], @"defaultButton": @0, @"cancelButton": @1, @"input": @{ @"placeholder": @"Password", @"defaultValue": @"hunter2", @"secure": @YES } }], appearance, output, [@"prompt-secure-" stringByAppendingString:suffix]);
    }
    // Arabic labels with right-to-left layout, as an Arabic app lays the accessory out.
    NSMutableDictionary *arabicControls = [NSMutableDictionary new];
    NSView *rtl = SparkAccessoryView(Accessory(@"تضمين البيانات الوصفية", @"التنسيق:", @[@"نص عادي", @"ماركداون", @"JSON"]), arabicControls);
    for (NSView *view in @[rtl, rtl.subviews.firstObject]) view.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
    RenderAccessory(rtl, NSAppearanceNameAqua, output, @"save-accessory-ar-light");
    CHECK(Offscreen());
  }
  if (failures) return 1;
  puts("Dialog configuration passed");
} }
