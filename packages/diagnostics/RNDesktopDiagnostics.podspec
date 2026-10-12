require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopDiagnostics"
  s.version = package["version"]
  s.summary = "Desktop diagnostics: main-thread hang watchdog, crash reporting"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  s.source_files = "macos/**/*.{h,m,mm}"
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  s.dependency "RNDesktopApp"
end
