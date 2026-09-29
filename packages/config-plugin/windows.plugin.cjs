const { nativeWindowOptions } = require("@legendapp/spark-window-options");
const { statePath } = require("./config.cjs");
const fs = require('node:fs');
const path = require('node:path');

function patchHost(source, core, metadata, defaults = {}) {
  source = source.replace(/\r\n/g, '\n').replace(/\n\/\/ BEGIN SPARK CORE[\s\S]*?\/\/ END SPARK CORE\n/g, '')
    .replace(/\n  \/\/ BEGIN SPARK TITLE[\s\S]*?\/\/ END SPARK TITLE\n/g, '')
    .replace(/\n  \/\/ BEGIN SPARK CONNECTION[\s\S]*?\/\/ END SPARK CONNECTION\n/g, '');
  source = source.replace(/\n    \/\/ BEGIN SPARK RUNTIMES[\s\S]*?\/\/ END SPARK RUNTIMES\n/g, '');
  const include = '#include "NativeModules.h"';
  const launchAnchor = 'winrt::init_apartment(winrt::apartment_type::single_threaded);';
  const anchor = 'auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};';
  if (!source.includes(include) || !source.includes(anchor) || !source.includes(launchAnchor) || (!source.includes("SparkWin::Initialize(reactNativeWin32App);") && !/appWindow\.Resize\([^\n]+\);/.test(source))) throw new Error('The pinned Windows host template changed; cannot install the Spark host hooks.');
  if (!['go', 'dev'].includes(metadata.mode) || !/^[a-f0-9]{64}$/.test(metadata.fingerprint)) throw new Error('Invalid Windows runtime build metadata');
  source = source.replace(/appWindow\.Title\([^\n]+\);/, title => `${title}\n  // BEGIN SPARK TITLE\n  const auto sparkTitle = SparkWindowsEnv(L"SPARK_PROJECT_NAME");\n  if (!sparkTitle.empty()) appWindow.Title(sparkTitle);\n  // END SPARK TITLE\n`);
  source = source.replace('SparkWin::Initialize(reactNativeWin32App);', 'appWindow.Resize({1000, 1000});');
  source = source.replace(/appWindow\.Resize\([^\n]+\);/, 'SparkWin::Initialize(reactNativeWin32App);');
  source = source.replace(/\n  \/\/ BEGIN SPARK LAUNCH[\s\S]*?\/\/ END SPARK LAUNCH\n/g, '');
  source = source.replace('winrt::init_apartment(winrt::apartment_type::single_threaded);', 'winrt::init_apartment(winrt::apartment_type::single_threaded);\n  // BEGIN SPARK LAUNCH\n  try { SparkInitializeEnvironment(); if (SparkWin::ForwardLaunch()) return 0; SparkWin::InitializeToastActivation(); }\n  catch (winrt::hresult_error const &error) { MessageBoxW(nullptr, error.message().c_str(), L"Spark launch failed", MB_OK | MB_ICONERROR); return 1; }\n  // END SPARK LAUNCH\n');
  source = source.replace(anchor, `${anchor}\n  // BEGIN SPARK CONNECTION\n  settings.SourceBundleHost(L"127.0.0.1");\n  settings.SourceBundlePort(SparkMetroPort());\n  // END SPARK CONNECTION\n`);
  if (core.includes('static void RegisterRuntimeSurface(')) {
    if (!source.includes('AddAttributedModules(packageBuilder, true);')) throw new Error('The pinned Windows host template changed; cannot register runtime surfaces.');
    source = source.replace('AddAttributedModules(packageBuilder, true);', 'AddAttributedModules(packageBuilder, true);\n    // BEGIN SPARK RUNTIMES\n    SparkWin::RegisterRuntimeSurface(packageBuilder);\n    // END SPARK RUNTIMES\n');
  }
  // Only patch the upstream template. Embedded host source can contain the same
  // API calls and must never be matched by these template replacements.
  return source.replace(include, `${include}\n// BEGIN SPARK CORE\n${core.replace('__SPARK_METADATA__', JSON.stringify(metadata)).replace('__SPARK_PROJECT_CONFIG__', JSON.stringify({ ...defaults, SPARK_RUNTIME_MODE: metadata.mode }).replaceAll(')', '\\u0029').replace(/[^\x00-\x7F]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')))}\n// END SPARK CORE\n`);
}
module.exports = config => {
  const { withAppCpp } = require('expo-desktop-config-plugins');
  config = withAppCpp(config, mod => {
    const root = mod.modRequest.projectRoot;
    const metadata = JSON.parse(fs.readFileSync(statePath(root, 'windows-build-input.json', 'windows'), 'utf8'));
    const { expo } = require('./config.cjs').readConfig(root);
    const defaults = metadata.mode === 'dev' ? {
      SPARK_PROJECT_ID: expo.extra.spark.projectId, SPARK_PROJECT_NAME: expo.name,
      SPARK_PROJECT_VERSION: expo.version, SPARK_WINDOW_CONFIG: JSON.stringify(nativeWindowOptions(expo.extra.spark.window ?? {})),
      SPARK_SESSION_FILE: statePath(root, 'windows-connection.json', 'windows'),
    } : {};
    mod.modResults.contents = patchHost(mod.modResults.contents, fs.readFileSync(require.resolve('@legendapp/spark-desktop-host/windows/runtime.inc'), 'utf8') + '\n' + fs.readFileSync(require.resolve('@legendapp/spark-desktop-host/windows/application.inc'), 'utf8') + '\n' + fs.readFileSync(require.resolve('@legendapp/spark-desktop-host/windows/notifications.inc'), 'utf8') + (Object.hasOwn(metadata.modules ?? {}, '@react-native-runtimes/core') ? '\n' + fs.readFileSync(require.resolve('@legendapp/spark-desktop-host/windows/runtimes.inc'), 'utf8') : ''), metadata, defaults);
    return mod;
  });
  const { withMod } = require('@expo/config-plugins');
  config = withMod(config, { platform: 'windows', mod: 'vcxproj', action: mod => {
    unpackagedApp(mod.modResults);
    return mod;
  }});
  return withMod(config, { platform: 'windows', mod: 'sln', action: mod => {
    mod.modResults.contents = withoutPackaging(mod.modResults.contents);
    return mod;
  }});
};
function withoutPackaging(source) {
  const guids = [];
  source = source.replace(/Project\([^\n]+\) = [^\n]*\.wapproj[^\n]*, "(\{[^}]+\})"\r?\n[\s\S]*?EndProject\r?\n/g, (_match, guid) => { guids.push(guid.toUpperCase()); return ''; });
  return source.split(/(?<=\n)/).filter(line => !guids.some(guid => line.toUpperCase().includes(guid))).join('');
}
module.exports.withoutPackaging = withoutPackaging;
module.exports.patchHost = patchHost;

function unpackagedApp(document) {
  const project = document.find(node => node.Project)?.Project;
  const globals = project?.find(node => node.PropertyGroup && node[':@']?.['@_Label'] === 'Globals')?.PropertyGroup;
  if (!globals) throw new Error('The pinned Windows app project has no Globals property group');
  // These apply only to the executable, never the autolinked library projects.
  for (const [key, value] of Object.entries({ WindowsPackageType: 'None', WindowsAppSDKSelfContained: 'true' })) {
    const existing = globals.find(node => key in node);
    if (existing) existing[key] = [{ '#text': value }];
    else globals.push({ [key]: [{ '#text': value }] });
  }
}
module.exports.unpackagedApp = unpackagedApp;
