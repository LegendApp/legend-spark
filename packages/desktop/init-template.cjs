module.exports = require("@legendapp/spark-cli/dist/init-template.cjs");
if (require.main === module) {
  const root = process.cwd();
  require("@legendapp/spark-desktop-config/patch-registry.cjs").ensurePatchRegistry(root).then(() => {
    module.exports.initializeTemplate(root);
    require("@legendapp/spark-desktop-config/native-patches.cjs").prepareNativePatches(root);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
