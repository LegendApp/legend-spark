require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopApp"
  s.version = package["version"]
  s.summary = "Desktop desktop-app"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  s.source_files = "macos/**/*.{h,m,mm}", "cpp/**/*.hpp"
  # Spark-owned native strings (SparkLocalization.h); every language holds the same keys.
  s.resource_bundles = { "SparkStrings" => ["macos/Localization/*.lproj"] }
  # SparkSandboxed reads its own entitlements (SecTask).
  s.frameworks = "Security"
  # The in-app test driver compiles in Debug builds, and in other builds only for apps that set macos.testDriverInRelease
  # (the Spark config plugin exports SPARK_TEST_DRIVER_RELEASE to the Podfile; docs/test-driver.md#builds).
  driver = { "SPARK_TEST_DRIVER" => ENV["SPARK_TEST_DRIVER_RELEASE"] == "1" ? "1" : "0", "SPARK_TEST_DRIVER[config=Debug]" => "1" }
  # Without the driver its sources are excluded (SPARK_TEST_DRIVER_SOURCES_0) and SparkTestDriver.h declares inline no-ops.
  # The app target gets the same setting, for the host's AppDelegate.
  s.user_target_xcconfig = driver.merge("GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) SPARK_TEST_DRIVER=$(SPARK_TEST_DRIVER)")
  # The driver's gesture and extra mouse button synthesis uses private CoreGraphics event functions. They compile
  # only in apps that set macos.testDriverPrivateEvents (the Spark config plugin exports this variable to the Podfile),
  # so other apps' binaries never name them (docs/test-driver.md#private-event-functions).
  private_events = ENV["SPARK_TEST_DRIVER_PRIVATE_EVENTS"] == "1" ? " SPARK_TEST_DRIVER_PRIVATE_EVENTS=1" : ""
  s.pod_target_xcconfig = driver.merge(
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) SPARK_TEST_DRIVER=$(SPARK_TEST_DRIVER)#{private_events}",
    "SPARK_TEST_DRIVER_SOURCES_0" => "SparkTestDriver*.mm",
    "EXCLUDED_SOURCE_FILE_NAMES" => "$(SPARK_TEST_DRIVER_SOURCES_$(SPARK_TEST_DRIVER))",
  )
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  # The development profiler drives Hermes's sampling profiler (SparkProfiler.mm, compiled only when RCT_DEV).
  s.dependency "hermes-engine"
end
