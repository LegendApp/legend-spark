// RN macOS 0.81.7 lists every JS runtime (each RCTHost) as an identical React Native DevTools target:
// "<bundle id> ()" (macOS reports no device name), described "React Native Bridgeless". Spark apps
// run a shared runtime plus isolated runtimes (@react-native-runtimes), so each target is titled by
// its runtime instead: "<app name> (shared runtime)" or "<app name> (isolated runtime: <name>)".
// A secondary runtime's name is known once its runtime delegate has run (it sets
// __THREADED_RUNTIME_ENV__.runtimeName), so RCTHost lists its target then, not in -start.
const fs = require("node:fs");
const path = require("node:path");
const replacements = {
  "ReactCommon/react/runtime/platform/ios/ReactCommon/RCTHost.mm": [
    [
      `@implementation RCTHost {
  RCTInstance *_instance;
`,
      `// [macOS] Spark: the DevTools target title of a JS runtime. Keep in sync with SparkDevToolsTargetTitle.
static std::string RCTHostInspectorTitle(facebook::jsi::Runtime &runtime)
{
  std::string label = "shared runtime";
  auto env = runtime.global().getProperty(runtime, "__THREADED_RUNTIME_ENV__");
  if (env.isObject()) {
    auto name = env.getObject(runtime).getProperty(runtime, "runtimeName");
    if (name.isString()) {
      label = "isolated runtime: " + name.getString(runtime).utf8(runtime);
    }
  }
  NSString *app = [RCTInspectorUtils getHostMetadata].appDisplayName;
  return [NSString stringWithFormat:@"%@ (%s)", app, label.c_str()].UTF8String;
}

@implementation RCTHost {
  RCTInstance *_instance;
`,
    ],
    [
      `  if (inspectorFlags.getFuseboxEnabled() && !_inspectorPageId.has_value()) {
    _inspectorTarget =
        facebook::react::jsinspector_modern::HostTarget::create(*_inspectorHostDelegate, [](auto callback) {
          RCTExecuteOnMainQueue(^{
            callback();
          });
        });
    __weak RCTHost *weakSelf = self;
    _inspectorPageId = facebook::react::jsinspector_modern::getInspectorInstance().addPage(
        "React Native Bridgeless",
        /* vm */ "",
        [weakSelf](std::unique_ptr<facebook::react::jsinspector_modern::IRemoteConnection> remote)
            -> std::unique_ptr<facebook::react::jsinspector_modern::ILocalConnection> {
          RCTHost *strongSelf = weakSelf;
          if (!strongSelf) {
            // This can happen if we're about to be dealloc'd. Reject the connection.
            return nullptr;
          }
          return strongSelf->_inspectorTarget->connect(std::move(remote));
        },
        {.nativePageReloads = true, .prefersFuseboxFrontend = true});
  }
`,
      `  // [macOS] Spark: the target is listed by -_addInspectorPageWithTitle: once the runtime is named.
  if (inspectorFlags.getFuseboxEnabled() && !_inspectorTarget) {
    _inspectorTarget =
        facebook::react::jsinspector_modern::HostTarget::create(*_inspectorHostDelegate, [](auto callback) {
          RCTExecuteOnMainQueue(^{
            callback();
          });
        });
  }
`,
    ],
    [
      `- (void)instance:(RCTInstance *)instance didInitializeRuntime:(facebook::jsi::Runtime &)runtime
{
  [self.runtimeDelegate host:self didInitializeRuntime:runtime];
}
`,
      `- (void)instance:(RCTInstance *)instance didInitializeRuntime:(facebook::jsi::Runtime &)runtime
{
  [self.runtimeDelegate host:self didInitializeRuntime:runtime];
  // [macOS] Spark: the runtime delegate has named this runtime. Listing happens once, on the main
  // queue like every other access to _inspectorPageId; reloads keep the target and its sessions.
  if (_inspectorTarget) {
    std::string title = RCTHostInspectorTitle(runtime);
    __weak RCTHost *weakSelf = self;
    RCTExecuteOnMainQueue(^{
      [weakSelf _addInspectorPageWithTitle:title];
    });
  }
}

- (void)_addInspectorPageWithTitle:(const std::string &)title
{
  if (!_inspectorTarget || _inspectorPageId.has_value()) {
    return;
  }
  __weak RCTHost *weakSelf = self;
  _inspectorPageId = facebook::react::jsinspector_modern::getInspectorInstance().addPage(
      title,
      /* vm */ "",
      [weakSelf](std::unique_ptr<facebook::react::jsinspector_modern::IRemoteConnection> remote)
          -> std::unique_ptr<facebook::react::jsinspector_modern::ILocalConnection> {
        RCTHost *strongSelf = weakSelf;
        if (!strongSelf) {
          // This can happen if we're about to be dealloc'd. Reject the connection.
          return nullptr;
        }
        return strongSelf->_inspectorTarget->connect(std::move(remote));
      },
      {.nativePageReloads = true, .prefersFuseboxFrontend = true});
}
`,
    ],
  ],
  "ReactCommon/jsinspector-modern/InspectorPackagerConnection.cpp": [
    [
      `    pageDescription["title"] = appName_ + " (" + deviceName_ + ")";
`,
      `    // [macOS] Spark: pages share one device connection; RCTHost titles each by its JS runtime.
    pageDescription["title"] = page.description;
`,
    ],
  ],
};
function patchDevToolsTargetsSource(file, source) {
  const pairs = replacements[file];
  if (!pairs) throw new Error(`Unknown DevTools targets patch target: ${file}`);
  if (pairs.every(([, after]) => source.includes(after))) return source;
  if (pairs.some(([before, after]) => source.split(before).length !== 2 || source.includes(after)))
    throw new Error(`React Native macOS inspector source changed (${file}); review the DevTools targets patch before building.`);
  return pairs.reduce((patched, [before, after]) => patched.replace(before, after), source);
}
function installDevToolsTargetsPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.81.7") throw new Error(`spark's DevTools targets patch requires react-native-macos@0.81.7; found ${version}.`);
  // Validate all targets before changing either file.
  const changes = Object.keys(replacements).map(relative => {
    const file = path.join(path.dirname(manifest), relative);
    const before = fs.readFileSync(file, "utf8");
    return { file, before, after: patchDevToolsTargetsSource(relative, before) };
  });
  for (const { file, before, after } of changes) if (before !== after) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, after);
    fs.renameSync(temporary, file); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { replacements, patchDevToolsTargetsSource, installDevToolsTargetsPatch };
