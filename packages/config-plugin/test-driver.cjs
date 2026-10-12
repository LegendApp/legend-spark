// The in-app test driver compiles in Debug builds. macos.testDriverInRelease adds it to other builds, and
// macos.testDriverPrivateEvents compiles its private CoreGraphics event functions. Each option exports a variable to the
// Podfile that the Spark podspecs turn into build settings (docs/test-driver.md#builds, #private-event-functions).
const OPTIONS = [
  ["testDriverInRelease", "SPARK_TEST_DRIVER_RELEASE", "# spark: test driver in release builds"],
  ["testDriverPrivateEvents", "SPARK_TEST_DRIVER_PRIVATE_EVENTS", "# spark: test driver private events"],
];

/** The Podfile with an opt-in line for each test driver option `macos` sets, and without the others. */
function testDriverPodfile(contents, macos) {
  return OPTIONS.reduce((podfile, [option, variable, marker]) => {
    const stripped = podfile.split("\n").filter(line => !line.endsWith(marker)).join("\n");
    return macos?.[option] === true ? `ENV['${variable}'] = '1' ${marker}\n${stripped}` : stripped;
  }, contents);
}

module.exports = { testDriverPodfile };
