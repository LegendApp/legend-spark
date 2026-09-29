const { withDesktop } = require("@legendapp/spark-cli/dist/metro.cjs");
const { getDefaultConfig, withSparkMetro } = require("@legendapp/spark-cli/dist/expo-metro.cjs");
const { metroConfig } = require("@legendapp/spark-cli/dist/universal.cjs");
module.exports = { withDesktop, metroConfig, getDefaultConfig, withSparkMetro };
