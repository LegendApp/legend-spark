require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopFileSystem"
  s.version = package["version"]
  s.summary = "Desktop file-system"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  s.source_files = "macos/**/*.{h,m,mm}"
  s.frameworks = "CoreServices"
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  s.dependency "RNDesktopApp"
  s.osx.frameworks = "CoreServices"
end
