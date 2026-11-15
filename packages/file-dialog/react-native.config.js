module.exports = {};

if (process.platform === "win32") {
  module.exports.dependencies = { ...module.exports.dependencies, "react-native-windows": {} };
}
