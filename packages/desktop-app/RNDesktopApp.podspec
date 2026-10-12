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
  # The test driver's gesture and extra mouse button synthesis uses private CoreGraphics event functions. They compile
  # only in apps that set macos.testDriverPrivateEvents (the Spark config plugin exports this variable to the Podfile),
  # so other apps' binaries never name them (docs/test-driver.md#private-event-functions).
  private_events = ENV["SPARK_TEST_DRIVER_PRIVATE_EVENTS"] == "1" ? { "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) SPARK_TEST_DRIVER_PRIVATE_EVENTS=1" } : {}
  s.pod_target_xcconfig = { "CLANG_CXX_LANGUAGE_STANDARD" => "c++20" }.merge(private_events)
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
end
