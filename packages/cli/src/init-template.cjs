const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepareConfig, toExpo } = require('@legendapp/spark-desktop-config/config.cjs');

// Expo SDK 58 still takes react-native-macos's pre-0.84 code paths (runtime delegate,
// root view factory, bundle configuration). Apply the upstream fix until Expo ships it.
const EXPO_PATCH = { version: '58.0.7', file: path.join(__dirname, 'expo@58.0.7.patch') };
function patchExpo(root) {
  const manifest = path.join(root, 'node_modules/expo/package.json');
  if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== EXPO_PATCH.version) return;
  const patch = args => execFileSync('patch', ['-p1', '-s', '-d', path.dirname(manifest), '-i', EXPO_PATCH.file, ...args], { stdio: 'pipe' });
  try {
    patch(['--dry-run', '-R', '-f']);
    return; // Already applied.
  } catch {}
  try {
    patch(['-N']);
  } catch (error) {
    throw new Error(`node_modules/expo does not match expo@${EXPO_PATCH.version} as published; delete it and reinstall.\n${error.stderr ?? error.message}`);
  }
}

// Expo Desktop assigns the application names and native IDs. Initialize only
// spark-owned configuration, once, after its template dependencies are installed.
function initializeTemplate(root) {
  patchExpo(root);
  const file = path.join(root, 'desktop.config.json');
  if (!fs.existsSync(file)) return;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.projectId) return;
  const { expo } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  if (!expo?.windows?.projectGuid || !expo.name || !expo.macos?.bundleIdentifier) {
    throw new Error('Create this template with expo-desktop create-app so its application identity is initialized.');
  }
  config.name = expo.name;
  config.projectId = expo.windows.projectGuid;
  config.expo = { ...expo, ...config.expo };
  if (config.macos) config.macos = { ...expo.macos, ...config.macos, bundleIdentifier: expo.macos.bundleIdentifier };
  toExpo(config);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  prepareConfig(root);
}
module.exports = { initializeTemplate };
if (require.main === module) initializeTemplate(process.cwd());
