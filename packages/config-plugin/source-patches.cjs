// Spark's patches to installed packages' sources. `spark build` installs them before it reads any source (the
// production analysis bundles patched JavaScript, so a build's fingerprint does not depend on whether an earlier
// build already patched node_modules); the config plugin installs them too, for a prebuild run on its own.
const fs = require("node:fs");
const path = require("node:path");

// Expo Desktop 1.0.0 renames the template's "HelloWorld" in every file its rename globs match, from the project root.
// matchBase applies "app.json" in every directory, and glob 10 ignores the "!**/node_modules" pattern, so each
// prebuild rewrote packages' app.json files in node_modules.
const renameGlob = `        // includes a symlink to an external directory.
        follow: false,
    });`;
const renameGlobFixed = `        // includes a symlink to an external directory.
        follow: false,
        ignore: "**/node_modules/**", // [Spark]
    });`;
function patchTemplateRenameSource(source) {
  if (source.includes(renameGlobFixed)) return source;
  if (source.split(renameGlob).length !== 2) throw new Error("Expo Desktop template renaming changed; review spark's rename patch before building.");
  return source.replace(renameGlob, renameGlobFixed);
}
function installTemplateRenamePatch(root) {
  const manifest = require.resolve("expo-desktop/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "1.0.0") throw new Error(`spark's template rename patch requires expo-desktop@1.0.0; found ${version}.`);
  const file = path.join(path.dirname(manifest), "build/common/expo/template.js");
  const source = fs.readFileSync(file, "utf8"), patched = patchTemplateRenameSource(source);
  if (source !== patched) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, file); // Do not modify package-cache hardlinks.
  }
}

function installSourcePatches(root) {
  installTemplateRenamePatch(root);
  require("./autolinking.cjs").installAutolinkingPatch(root);
  require("./fabric-lifecycle.cjs").installSurfaceLifecyclePatch(root);
  require("./keyboard-events.cjs").installKeyboardEventsPatch(root);
  require("./rtl-scroll-view.cjs").installRTLScrollViewPatch(root);
  require("./rtl-text-alignment.cjs").installRTLTextAlignmentPatch(root);
  require("./rtl-text-input-alignment.cjs").installRTLTextInputAlignmentPatch(root);
  require("./devtools-targets.cjs").installDevToolsTargetsPatch(root);
  require("./text-services.cjs").installTextServicesPatch(root);
  require("./text-input-accessibility.cjs").installTextInputAccessibilityPatch(root);
  require("./accessibility-state.cjs").installAccessibilityStatePatch(root);
}
module.exports = { patchTemplateRenameSource, installTemplateRenamePatch, installSourcePatches };
