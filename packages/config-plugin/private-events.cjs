// The test driver's gesture and extra mouse button synthesis uses private CoreGraphics event functions. An app opts in
// with macos.testDriverPrivateEvents; this exports SPARK_TEST_DRIVER_PRIVATE_EVENTS to its Podfile, and the RNDesktopApp
// podspec turns that into the preprocessor flag that compiles them (docs/test-driver.md#private-event-functions).
const MARKER = "# spark: test driver private events";

/** The Podfile with the opt-in line for `enabled`, and without it otherwise. */
function privateEventsPodfile(contents, enabled) {
  const stripped = contents.split("\n").filter(line => !line.endsWith(MARKER)).join("\n");
  return enabled === true ? `ENV['SPARK_TEST_DRIVER_PRIVATE_EVENTS'] = '1' ${MARKER}\n${stripped}` : stripped;
}

module.exports = { privateEventsPodfile };
