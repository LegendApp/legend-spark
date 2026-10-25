// The in-app test driver compiles in Debug builds; macos.testDriverInRelease adds it to other builds by exporting a
// variable to the Podfile that the Spark podspecs turn into a build setting (docs/test-driver.md#builds).
const MARKER = "# spark: test driver in release builds";

/** The Podfile with the release opt-in line when `macos` sets testDriverInRelease, and without it otherwise. */
function testDriverPodfile(contents, macos) {
  const stripped = contents.split("\n").filter(line => !line.endsWith(MARKER)).join("\n");
  return macos?.testDriverInRelease === true ? `ENV['SPARK_TEST_DRIVER_RELEASE'] = '1' ${MARKER}\n${stripped}` : stripped;
}

module.exports = { testDriverPodfile };
