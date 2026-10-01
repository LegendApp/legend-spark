Pod::Spec.new do |s|
  s.name = 'SparkNitroProbe'
  s.version = '0.0.1'
  s.summary = 'Generated Nitro view compatibility probe for React Native macOS'
  s.homepage = 'https://github.com/LegendApp'
  s.license = 'MIT'
  s.author = 'Spark'
  s.source = { :git => 'https://github.com/LegendApp/legend-spark.git' }
  s.platforms = { :osx => '14.0' }
  s.source_files = 'macos/**/*.swift'
  load 'nitrogen/generated/ios/SparkNitroProbe+autolinking.rb'
  add_nitrogen_files(s)
  install_modules_dependencies(s)
end
