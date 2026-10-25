const fs = require('node:fs');
const path = require('node:path');
const { prepareConfig, toExpo } = require('@legendapp/spark-desktop-config/config.cjs');

// Expo Desktop assigns the application names and native IDs. Initialize only
// spark-owned configuration, once, after its template dependencies are installed.
function initializeTemplate(root) {
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
  const { version, ...macos } = expo.macos;
  if (config.macos) config.macos = { ...macos, ...config.macos, bundleIdentifier: macos.bundleIdentifier };
  toExpo(config);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  prepareConfig(root);
}
module.exports = { initializeTemplate };
if (require.main === module) initializeTemplate(process.cwd());
