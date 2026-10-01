module.exports = {
  dependency: {
    platforms: {
      // Expo Desktop invokes the Apple autolinker with the iOS platform.
      ios: process.env.SPARK_DESKTOP_AUTOLINK === "macos" ? {} : null,
      android: null,
      windows: null,
      macos: { podspecPath: "./RNCodex.podspec" },
    },
  },
};
