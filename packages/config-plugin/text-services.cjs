// RN macOS 0.81.7 TextInput text services. Multiline inputs are NSTextViews in a scroll view but leave the find
// bar off, so Edit > Find (performFindPanelAction:) is disabled in them. Writing Tools has no per-input control.
// The patch turns on the NSTextFinder find bar with incremental search for multiline inputs and adds a
// `writingToolsBehavior` trait ("default", "complete", "limited", "none"), applied to the multiline NSTextView and to a
// single-line field's field editor while it edits. The field editor is shared per window, so it returns to the system
// value when editing ends.
const fs = require("node:fs");
const path = require("node:path");
const replacements = {
  "Libraries/Components/TextInput/RCTTextInputViewConfig.js": [[
    `    submitKeyEvents: true,
    tooltip: true,
`,
    `    submitKeyEvents: true,
    tooltip: true,
    writingToolsBehavior: true, // [Spark]
`,
  ]],
  "ReactCommon/react/renderer/components/textinput/platform/ios/react/renderer/components/iostextinput/primitives.h": [[
    `   bool clearTextOnSubmit{false};
#endif // macOS]
`,
    `   bool clearTextOnSubmit{false};

  /*
   * [Spark] Writing Tools behavior: "default", "complete", "limited" or "none".
   * macOS 15+
   */
  std::string writingToolsBehavior{"default"};
#endif // macOS]
`,
  ]],
  "ReactCommon/react/renderer/components/textinput/platform/ios/react/renderer/components/iostextinput/propsConversions.h": [[
    `      "pastedTypes",
      sourceTraits.pastedTypes,
      defaultTraits.pastedTypes);
#endif // macOS]
`,
    `      "pastedTypes",
      sourceTraits.pastedTypes,
      defaultTraits.pastedTypes);
  traits.writingToolsBehavior = convertRawProp( // [Spark]
      context,
      rawProps,
      "writingToolsBehavior",
      sourceTraits.writingToolsBehavior,
      defaultTraits.writingToolsBehavior);
#endif // macOS]
`,
  ]],
  "Libraries/Text/TextInput/Multiline/RCTUITextView.mm": [[
    `    self.canDrawSubviewsIntoLayer = YES;
    self.allowsUndo = YES;
`,
    `    self.canDrawSubviewsIntoLayer = YES;
    self.allowsUndo = YES;
    // [Spark] Edit > Find shows the NSTextFinder find bar in the enclosing scroll view.
    self.usesFindBar = YES;
    self.incrementalSearchingEnabled = YES;
`,
  ]],
  "React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm": [[
    `#if TARGET_OS_OSX // [macOS
static NSString *kEscapeKeyCode = @"\\x1B";
#endif // macOS]
`,
    `#if TARGET_OS_OSX // [macOS
static NSString *kEscapeKeyCode = @"\\x1B";

#import <React/RCTLog.h> // [Spark]
#import <objc/runtime.h> // [Spark]
// [Spark] Writing Tools behavior for a backed view's responder: the multiline NSTextView itself, or a single-line
// NSTextField's field editor while that field edits. The window's fields share that editor, so its AppKit value
// (field editors default to limited) is kept and restored when the field stops editing.
static BOOL RCTSparkIsWritingToolsBehavior(const std::string &behavior)
{
  return behavior == "default" || behavior == "complete" || behavior == "limited" || behavior == "none";
}
static NSInteger RCTSparkWritingToolsBehavior(const std::string &behavior)
{
  if (@available(macOS 15.0, *)) {
    return behavior == "none" ? NSWritingToolsBehaviorNone
        : behavior == "complete" ? NSWritingToolsBehaviorComplete
        : behavior == "limited" ? NSWritingToolsBehaviorLimited
        : NSWritingToolsBehaviorDefault;
  }
  return 0;
}
static char RCTSparkFieldEditorWritingToolsKey;
static void RCTSparkApplyWritingToolsBehavior(NSResponder *responder, const std::string &behavior)
{
  if (@available(macOS 15.0, *)) {
    if ([responder isKindOfClass:NSTextView.class]) {
      ((NSTextView *)responder).writingToolsBehavior = (NSWritingToolsBehavior)RCTSparkWritingToolsBehavior(behavior);
    } else if ([responder isKindOfClass:NSTextField.class]) {
      NSTextView *editor = (NSTextView *)((NSTextField *)responder).currentEditor;
      if (![editor isKindOfClass:NSTextView.class]) return;
      // Keep AppKit's own field editor value for RCTSparkResetFieldEditorWritingTools.
      if (!objc_getAssociatedObject(editor, &RCTSparkFieldEditorWritingToolsKey)) {
        objc_setAssociatedObject(editor, &RCTSparkFieldEditorWritingToolsKey, @(editor.writingToolsBehavior), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      }
      editor.writingToolsBehavior = (NSWritingToolsBehavior)RCTSparkWritingToolsBehavior(behavior);
    }
  }
}
/** After a single-line field stops editing, gives the window's field editor back its AppKit value unless another field took it. */
static void RCTSparkResetFieldEditorWritingTools(NSResponder *responder)
{
  if (@available(macOS 15.0, *)) {
    if (![responder isKindOfClass:NSTextField.class]) return;
    NSTextField *field = (NSTextField *)responder;
    NSTextView *editor = (NSTextView *)[field.window fieldEditor:NO forObject:field];
    NSNumber *original = [editor isKindOfClass:NSTextView.class] ? objc_getAssociatedObject(editor, &RCTSparkFieldEditorWritingToolsKey) : nil;
    if (!original || (editor.delegate != nil && editor.delegate != (id)field)) return;
    editor.writingToolsBehavior = (NSWritingToolsBehavior)original.integerValue;
    objc_setAssociatedObject(editor, &RCTSparkFieldEditorWritingToolsKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
}
#endif // macOS]
`,
  ], [
    `  if (newTextInputProps.enableFocusRing != oldTextInputProps.enableFocusRing) {
    if ([_backedTextInputView respondsToSelector:@selector(setEnableFocusRing:)]) {
      [_backedTextInputView setEnableFocusRing:newTextInputProps.enableFocusRing];
    }
  }
#endif // macOS]
`,
    `  if (newTextInputProps.enableFocusRing != oldTextInputProps.enableFocusRing) {
    if ([_backedTextInputView respondsToSelector:@selector(setEnableFocusRing:)]) {
      [_backedTextInputView setEnableFocusRing:newTextInputProps.enableFocusRing];
    }
  }

  // [Spark] A multiline or secure-entry change replaced the backed view, so apply the behavior to the new one too.
  if (newTextInputProps.traits.writingToolsBehavior != oldTextInputProps.traits.writingToolsBehavior ||
      newTextInputProps.multiline != oldTextInputProps.multiline ||
      newTextInputProps.traits.secureTextEntry != oldTextInputProps.traits.secureTextEntry) {
    if (!RCTSparkIsWritingToolsBehavior(newTextInputProps.traits.writingToolsBehavior)) {
      RCTLogError(@"TextInput writingToolsBehavior must be \\"default\\", \\"complete\\", \\"limited\\" or \\"none\\"; got \\"%s\\"", newTextInputProps.traits.writingToolsBehavior.c_str());
    }
    RCTSparkApplyWritingToolsBehavior(_backedTextInputView.responder, newTextInputProps.traits.writingToolsBehavior);
  }
#endif // macOS]
`,
  ], [
    `- (void)textInputDidBeginEditing
{
`,
    `- (void)textInputDidBeginEditing
{
#if TARGET_OS_OSX // [Spark] A single-line field's field editor takes this input's behavior while it edits.
  RCTSparkApplyWritingToolsBehavior(_backedTextInputView.responder, static_cast<const TextInputProps &>(*_props).traits.writingToolsBehavior);
#endif // [Spark]
`,
  ], [
    `- (void)textInputDidEndEditing
{
`,
    `- (void)textInputDidEndEditing
{
#if TARGET_OS_OSX // [Spark] Return the window's shared field editor to the system default.
  RCTSparkResetFieldEditorWritingTools(_backedTextInputView.responder);
#endif // [Spark]
`,
  ]],
};
function patchTextServicesSource(file, source) {
  const pairs = replacements[file];
  if (!pairs) throw new Error(`Unknown text services patch target: ${file}`);
  if (pairs.every(([, after]) => source.includes(after))) return source;
  if (pairs.some(([before, after]) => source.split(before).length !== 2 || source.includes(after)))
    throw new Error(`React Native macOS TextInput source changed (${file}); review the text services patch before building.`);
  return pairs.reduce((patched, [before, after]) => patched.replace(before, after), source);
}
function installTextServicesPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.81.7") throw new Error(`spark's text services patch requires react-native-macos@0.81.7; found ${version}.`);
  // Validate every target before changing any file.
  const changes = Object.keys(replacements).map(relative => {
    const file = path.join(path.dirname(manifest), relative);
    const before = fs.readFileSync(file, "utf8");
    return { file, before, after: patchTextServicesSource(relative, before) };
  });
  for (const { file, before, after } of changes) if (before !== after) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, after);
    fs.renameSync(temporary, file); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { replacements, patchTextServicesSource, installTextServicesPatch };
