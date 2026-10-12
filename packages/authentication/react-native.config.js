// Expo Desktop currently invokes the Apple autolinker with --platform ios.
// Its generated Podfile identifies macOS explicitly. Sign in with Apple and passkeys have no mobile or Windows backend yet (#423).
module.exports = { dependency: { platforms: {
  ios: process.env.SPARK_DESKTOP_AUTOLINK === "macos" ? {} : null,
  android: null,
  windows: null,
} } };
