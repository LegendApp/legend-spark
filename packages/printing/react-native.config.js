// Expo Desktop currently invokes the Apple autolinker with --platform ios.
// Its generated Podfile identifies macOS explicitly. Printing has no mobile or Windows backend yet.
module.exports = { dependency: { platforms: {
  ios: process.env.SPARK_DESKTOP_AUTOLINK === "macos" ? {} : null,
  android: null,
  windows: null,
} } };
