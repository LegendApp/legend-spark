const { statePath } = require("./config.cjs");
const fs = require("node:fs");
const path = require("node:path");
const {
  withAppDelegate,
  withPodfile,
  withInfoPlist,
  withEntitlementsPlist,
} = require("expo-desktop-config-plugins");
const { identity } = require("./identity.cjs");
const { resolveEntitlements } = require("./entitlements.cjs");

module.exports = function withSparkDesktop(config) {
  if (config.platforms?.length === 1 && config.platforms[0] === "windows") return require("./windows.plugin.cjs")(config);
  // The upstream base mod merges template entitlements into config before
  // callbacks run. Capture the declared values before that mutation.
  const declaredEntitlements = structuredClone(config.macos?.entitlements ?? {});
  config = withEntitlementsPlist(config, (mod) => {
    const selection = statePath(mod.modRequest.projectRoot, "native-selection.json", "macos");
    const packages = fs.existsSync(selection)
      ? JSON.parse(fs.readFileSync(selection, "utf8")).included.map((pkg) => JSON.parse(fs.readFileSync(path.join(pkg.root, "package.json"), "utf8")))
      : [];
    // Own the generated entitlements; the desktop template's sandbox defaults
    // are not the framework's direct-distribution policy.
    mod.modResults = resolveEntitlements({ macos: { entitlements: declaredEntitlements } }, packages);
    return mod;
  });
  config = withAppDelegate(config, (mod) => {
    // Own this adapter; application customizations belong in configuration/plugins.
    mod.modResults.contents = fs.readFileSync(require.resolve("@legendapp/spark-desktop-host/AppDelegate.mm"), "utf8");
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    const generated = identity(config);
    for (const key of ["SUFeedURL", "SUPublicEDKey", "SUEnableAutomaticChecks", "SUAutomaticallyUpdate", "SUAllowsAutomaticUpdates", "SUEnableSystemProfiling", "SURequireSignedFeed", "SUVerifyUpdateBeforeExtraction"])
      if (!(key in generated)) delete mod.modResults[key];
    Object.assign(mod.modResults, generated);
    mod.modResults.SparkFrameworkVersion = "0.1.0-prototype.0";
    mod.modResults.NSAppTransportSecurity = { NSAllowsLocalNetworking: true };
    return mod;
  });
  return withPodfile(config, (mod) => {
    require("./fabric-lifecycle.cjs").installSurfaceLifecyclePatch(mod.modRequest.projectRoot);
    require("./keyboard-events.cjs").installKeyboardEventsPatch(mod.modRequest.projectRoot);
    // The beta template passes the resolved package to use_react_native!, but
    // post_install otherwise resets Xcode script paths to ../node_modules.
    mod.modResults.contents = mod.modResults.contents.replace(
      "react_native_post_install(installer)",
      'react_native_post_install(installer, "#{config[:reactNativePath]}-macos")',
    );
    // Bun/pnpm may resolve RN and RN macOS into different physical directories.
    // Appending "-macos" to RN's resolved path is only valid for flat installs.
    const macOSPath = JSON.stringify(path.relative(path.join(mod.modRequest.projectRoot, "macos"), path.dirname(require.resolve("react-native-macos/package.json", {
      paths: [mod.modRequest.projectRoot],
    })))).replace(/#\{/g, "\\#{");
    mod.modResults.contents = mod.modResults.contents.replaceAll('"#{config[:reactNativePath]}-macos"', macOSPath);
    const selectionFile = statePath(mod.modRequest.projectRoot, "native-selection.json", "macos");
    const included = fs.existsSync(selectionFile) ? JSON.parse(fs.readFileSync(selectionFile, "utf8")).included : [];
    const updatePackage = included.find(pkg => pkg.name === "@legendapp/spark-updates");
    // Pin the spec and archive with the SDK, avoiding a mutable CocoaPods index.
    const sparkleMarker = "# spark: Sparkle pod";
    mod.modResults.contents = mod.modResults.contents.replace(/^.*# spark: Sparkle pod\n/gm, "");
    if (updatePackage) {
      const spec = path.join(updatePackage.root, "Sparkle.podspec.json");
      const rubyPath = JSON.stringify(spec).replace(/#\{/g, "\\#{");
      mod.modResults.contents += `\npod 'Sparkle', :podspec => ${rubyPath} ${sparkleMarker}\n`;
    }
    const autolinkMarker = "# spark: macOS autolinking";
    if (!mod.modResults.contents.includes(autolinkMarker)) {
      mod.modResults.contents = `${autolinkMarker}\nENV['SPARK_DESKTOP_AUTOLINK'] = 'macos'\n${mod.modResults.contents}`;
    }
    const marker = "# spark: Fabric enabled";
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = `${marker}\nENV['RCT_NEW_ARCH_ENABLED'] = '1'\n${mod.modResults.contents}`;
    }
    return mod;
  });
};
