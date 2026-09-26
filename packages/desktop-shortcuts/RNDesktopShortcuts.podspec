require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "RNDesktopShortcuts"
  s.version = package["version"]
  s.summary = "Desktop desktop-shortcuts"
  s.license = { :type => "MIT" }
  s.author = "Legend"
  s.homepage = "https://legendapp.com"
  s.source = { :path => "." }
  s.platforms = { :osx => "14.0" }
  s.source_files = "macos/**/*.{h,m,mm}"
  s.dependency "React-Core"
  s.dependency "ReactCodegen"
  s.dependency "RNDesktopApp"
  s.osx.frameworks = "AppKit", "Carbon"
end
