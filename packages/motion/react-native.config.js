// Expo Desktop currently invokes the Apple autolinker with --platform ios.
// Its generated Podfile identifies macOS explicitly. Motion has no mobile or Windows backend.
module.exports = { dependency: { platforms: {
  ios: process.env.SPARK_DESKTOP_AUTOLINK === "macos" ? {} : null,
  android: null,
  windows: null,
} } };
