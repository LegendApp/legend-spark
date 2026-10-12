require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopDrag"
  s.version = package["version"]
  s.summary = "Desktop drag and drop"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.frameworks = "UniformTypeIdentifiers"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  s.source_files = "macos/**/*.{h,m,mm}"
  # The in-app test driver compiles in Debug builds, and in other builds only for apps that set macos.testDriverInRelease
  # (the Spark config plugin exports SPARK_TEST_DRIVER_RELEASE to the Podfile; docs/test-driver.md#builds).
  s.pod_target_xcconfig = { "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/Headers/Private/Yoga\"", "SPARK_TEST_DRIVER" => ENV["SPARK_TEST_DRIVER_RELEASE"] == "1" ? "1" : "0",
    "SPARK_TEST_DRIVER[config=Debug]" => "1", "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) SPARK_TEST_DRIVER=$(SPARK_TEST_DRIVER)" }
  s.dependency "React-RCTFabric"
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  s.dependency "RNDesktopApp"
  s.dependency "React-RCTAppDelegate"
end
