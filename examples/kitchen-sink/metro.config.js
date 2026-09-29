const { withUniwindConfig } = require("uniwind/metro");
const { metroConfig } = require("@legendapp/spark/metro");

const path = require("node:path");
const fs = require("node:fs");
const config = metroConfig(__dirname);
const sidecar = path.resolve(__dirname, "../sidecar");
if (fs.existsSync(path.join(sidecar, "client.ts"))) config.watchFolders = [...(config.watchFolders ?? []), sidecar];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
