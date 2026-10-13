// macos.privilegedHelpers: the helpers (from `helpers`) an app runs as launchd daemons through
// @legendapp/spark/privileged-helper (docs/privileged-helper.md#configuration). Shared by configuration validation and
// spark build, which writes each one's plist into Contents/Library/LaunchDaemons. Nothing is written without the option.
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function validatePrivilegedHelpers(names, helpers = {}) {
  if (names === undefined) return;
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(name => typeof name !== "string" || !NAME.test(name)))
    throw new Error("macos.privilegedHelpers must list unique helper names (1–64 letters, digits, - and _)");
  for (const name of names) {
    const helper = helpers?.[name];
    if (helper === undefined) throw new Error(`macos.privilegedHelpers lists ${name}, which helpers does not declare`);
    if (typeof helper !== "string" && !helper["macos-arm64"] && !helper["macos-x64"]) throw new Error(`macos.privilegedHelpers lists ${name}, which has no macOS bundle in helpers`);
  }
}

// The executable launchd runs, relative to the app bundle, where spark build copies the helper.
function privilegedHelperProgram(name, helper, arch) {
  if (typeof helper === "string") return `Contents/Helpers/${name}`;
  const bundle = helper[`macos-${arch}`];
  if (!bundle) throw new Error(`Helper ${name} has no macos-${arch} bundle`);
  return `Contents/Helpers/${name}.helper/${bundle.executable}`;
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// The daemon's launchd plist. Label and Mach service: <bundle identifier>.<name>, the name the helper listens on and the
// app connects to. AssociatedBundleIdentifiers shows the app's name and icon for it in Login Items.
function privilegedHelperPlist(bundleIdentifier, name, program) {
  const label = escape(`${bundleIdentifier}.${name}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>BundleProgram</key>
  <string>${escape(program)}</string>
  <key>MachServices</key>
  <dict>
    <key>${label}</key>
    <true/>
  </dict>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>${escape(bundleIdentifier)}</string>
  </array>
</dict>
</plist>
`;
}

// Writes Contents/Library/LaunchDaemons/<label>.plist for each opted-in helper of `app` (after spark build copied the
// helpers); returns the files written. Without macos.privilegedHelpers it writes nothing.
function writePrivilegedHelpers(app, macos, helpers, arch) {
  const fs = require("node:fs");
  const path = require("node:path");
  const names = macos?.privilegedHelpers;
  validatePrivilegedHelpers(names, helpers);
  if (!names) return [];
  const directory = path.join(app, "Contents/Library/LaunchDaemons");
  fs.mkdirSync(directory, { recursive: true });
  return names.map((name) => {
    const program = privilegedHelperProgram(name, helpers[name], arch);
    if (!fs.existsSync(path.join(app, program))) throw new Error(`Privileged helper ${name} is not in the app at ${program}`);
    const file = path.join(directory, `${macos.bundleIdentifier}.${name}.plist`);
    fs.writeFileSync(file, privilegedHelperPlist(macos.bundleIdentifier, name, program));
    return file;
  });
}

// The signing identifier each embedded helper must carry, by its path in the bundle: its launchd label, which the app
// pins in its code signing requirement for the helper (docs/privileged-helper.md#threat-model). Read from the plists
// writePrivilegedHelpers wrote; any other file there is an error, not skipped.
function privilegedHelperIdentifiers(app) {
  const fs = require("node:fs");
  const path = require("node:path");
  const directory = path.join(app, "Contents/Library/LaunchDaemons");
  if (!fs.existsSync(directory)) return {};
  const identifiers = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const text = fs.readFileSync(path.join(directory, name), "utf8");
    const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
    const program = /<key>BundleProgram<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1];
    if (!label || !program || name !== `${label}.plist`) throw new Error(`Contents/Library/LaunchDaemons/${name} is not a launch daemon plist spark build wrote`);
    identifiers[program] = label;
  }
  return identifiers;
}

module.exports = { validatePrivilegedHelpers, privilegedHelperProgram, privilegedHelperPlist, writePrivilegedHelpers, privilegedHelperIdentifiers };
