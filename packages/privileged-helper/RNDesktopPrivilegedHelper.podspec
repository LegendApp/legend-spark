require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopPrivilegedHelper"
  s.version = package["version"]
  s.summary = "Privileged helpers through SMAppService, the admin prompt and XPC"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  # The helper side (helper/SparkPrivilegedHelperService.m) is compiled into the app's helper, never into the app.
  s.source_files = "macos/**/*.{h,m,mm}", "helper/SparkPrivilegedHelperProtocol.h"
  s.frameworks = "Foundation", "ServiceManagement", "Security"
  # The in-app test driver compiles in Debug builds, and in other builds only for apps that set macos.testDriverInRelease
  # (the Spark config plugin exports SPARK_TEST_DRIVER_RELEASE to the Podfile; docs/test-driver.md#builds).
  s.pod_target_xcconfig = { "SPARK_TEST_DRIVER" => ENV["SPARK_TEST_DRIVER_RELEASE"] == "1" ? "1" : "0", "SPARK_TEST_DRIVER[config=Debug]" => "1", "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) SPARK_TEST_DRIVER=$(SPARK_TEST_DRIVER)" }
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  s.dependency "RNDesktopApp"
end
