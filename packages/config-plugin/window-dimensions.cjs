// RN macOS 0.83.0 Dimensions.get("window") reports the whole display and never follows resizes: RCTDeviceInfo reads
// the key window, which doesn't exist yet when the module starts (it falls back to the screen), observes only that
// window's frame, reports the frame (title bar included) and publishes only while the app is active. This backports
// microsoft/react-native-macos#3142 (open; keep until a release ships it): observe every window's resize, report the
// content rect, fall back to the main window, then the frontmost visible non-panel window (Spark: then any non-panel window), and publish in the
// background. Spark also skips panels (an open panel or alert is key while it shows), reports the window's own display
// as "screen", and follows a move to another display, a change of main window, and a window coming on screen (the
// module starts before the host shows its window, and a background launch never makes it key or main).
const fs = require("node:fs");
const path = require("node:path");
const file = "React/CoreModules/RCTDeviceInfo.mm";
const observers = ["NSWindowDidResizeNotification", "NSWindowDidChangeScreenNotification", "NSWindowDidChangeBackingPropertiesNotification", "NSWindowDidBecomeMainNotification", "NSWindowDidChangeOcclusionStateNotification", "NSApplicationDidChangeScreenParametersNotification"];
const replacements = [
  [`#if TARGET_OS_IOS

  _currentInterfaceOrientation = RCTKeyWindow().windowScene.interfaceOrientation;
`, `#if TARGET_OS_OSX // [Spark] Follow every window's size and display (react-native-macos#3142).
  for (NSNotificationName name in @[ ${observers.join(", ")} ]) {
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(interfaceFrameDidChange) name:name object:nil];
  }
#endif // [Spark]

#if TARGET_OS_IOS

  _currentInterfaceOrientation = RCTKeyWindow().windowScene.interfaceOrientation;
`],
  [`  [_applicationWindow removeObserver:self forKeyPath:kFrameKeyPath];
`, `  [_applicationWindow removeObserver:self forKeyPath:kFrameKeyPath];

#if TARGET_OS_OSX // [Spark]
  for (NSNotificationName name in @[ ${observers.join(", ")} ]) {
    [[NSNotificationCenter defaultCenter] removeObserver:self name:name object:nil];
  }
#endif // [Spark]
`],
  [`static NSDictionary *RCTExportedDimensions(CGFloat fontScale)
{`, `#if TARGET_OS_OSX // [Spark] The window whose size is reported: in the background no window is key or main, though
// the app's window is still on screen, so fall back to the frontmost visible window that is not a panel, then to any.
static NSWindow *RCTDimensionsWindow(void)
{
  NSWindow *window = RCTKeyWindow();
  if (window != nil && ![window isKindOfClass:[NSPanel class]]) {
    return window;
  }
  if (NSApp.mainWindow != nil) {
    return NSApp.mainWindow;
  }
  for (NSWindow *candidate in NSApp.orderedWindows) {
    if (candidate.isVisible && ![candidate isKindOfClass:[NSPanel class]]) {
      return candidate;
    }
  }
  // A window not shown yet (or kept hidden, as Spark's test driver does) is still the size the root view gets.
  for (NSWindow *candidate in NSApp.windows) {
    if (![candidate isKindOfClass:[NSPanel class]]) {
      return candidate;
    }
  }
  return nil;
}
#endif // [Spark]

static NSDictionary *RCTExportedDimensions(CGFloat fontScale)
{`],
  [`  NSScreen *mainScreen = NSScreen.mainScreen;
  CGSize screenSize = mainScreen.frame.size;
  NSWindow *mainWindow = RCTKeyWindow();
`, `  NSWindow *mainWindow = RCTDimensionsWindow(); // [Spark] and the display it is on
  NSScreen *mainScreen = mainWindow.screen ?: NSScreen.mainScreen;
  CGSize screenSize = mainScreen.frame.size;
`],
  [`  CGSize windowSize = mainWindow ? mainWindow.frame.size : screenSize; //[macOS]
`, `  CGSize windowSize = mainWindow ? [mainWindow contentRectForFrameRect:mainWindow.frame].size : screenSize; // [Spark] content, not frame
`],
  [`  if (!([nextInterfaceDimensions isEqual:_currentInterfaceDimensions]) && RCTIsAppActive()) {
`, `#if !TARGET_OS_OSX // [Spark] A Mac app's window stays on screen in the background, and can be resized there.
  if (!([nextInterfaceDimensions isEqual:_currentInterfaceDimensions]) && RCTIsAppActive()) {
#else
  if (!([nextInterfaceDimensions isEqual:_currentInterfaceDimensions])) {
#endif // [Spark]
`],
];
function patchWindowDimensionsSource(source) {
  if (replacements.every(([, after]) => source.includes(after))) return source;
  for (const [before] of replacements)
    if (source.split(before).length !== 2)
      throw new Error(`React Native macOS DeviceInfo source changed (${file}); review the window dimensions patch before building.`);
  return replacements.reduce((text, [before, after]) => text.replace(before, after), source);
}
function unpatchWindowDimensionsSource(source) {
  return replacements.reduceRight((text, [before, after]) => text.replace(after, before), source);
}
function installWindowDimensionsPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`spark's window dimensions patch requires react-native-macos@0.83.0; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const source = fs.readFileSync(target, "utf8"), patched = patchWindowDimensionsSource(source);
  if (source !== patched) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { file, patchWindowDimensionsSource, unpatchWindowDimensionsSource, installWindowDimensionsPatch };
