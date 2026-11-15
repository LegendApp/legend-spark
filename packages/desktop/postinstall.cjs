const path = require("node:path");
const fs = require("node:fs");
const { ensurePatchRegistry } = require("@legendapp/spark-desktop-config/patch-registry.cjs");
const { prepareNativePatches } = require("@legendapp/spark-desktop-config/native-patches.cjs");
const initial = process.env.INIT_CWD;
const root = initial && fs.existsSync(path.join(initial, "package.json")) ? initial : __dirname;
ensurePatchRegistry(root).then(() => prepareNativePatches(root)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
