const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const VERSION = '54.0.27';
const extension = JSON.stringify(path.join(__dirname, 'expo-dev-extension.cjs'));
// Process-local patches: installed Expo files remain untouched. Verify the exact
// upstream inputs before starting, so an Expo upgrade cannot silently lose keys.
const patches = [
  ['interface/commandsTable.js', 'eeb1700b0ae26613bf6dedab556479a4c15d3a3c94c63ecbb5db21c4899e1645',
    'function logCommandsTable(ui) {',
    `function logCommandsTable(ui) {\n    ui = require(${extension}).integrateCommands(ui);`],
  ['interface/startInterface.js', 'c8e55431b18a37e1ab2be22f068c980e9cc41ffc105ea7478e34fc11b91a22bd',
    '    const onPressAsync = async (key)=>{',
    `    const onPressAsync = async (key)=>{\n        try {\n            if (await require(${extension}).handleKey(key)) return;\n        } catch (error) {\n            _log.exception(error);\n            return;\n        }`],
  ['startAsync.js', '0e062078e63ad6264b1393d403ad56d65a38c6430d30fdac50cd656486cd418b',
    '    await (0, _profile.profile)(devServerManager.startAsync.bind(devServerManager))(startOptions);',
    // Dependency validation can wait on the network after Metro is listening.
    // Report actual server readiness before those optional startup checks.
    `    await (0, _profile.profile)(devServerManager.startAsync.bind(devServerManager))(startOptions);\n    require(${extension}).ready(devServerManager.getNativeDevServerPort(), { dev: options.dev, minify: options.minify, https: options.https });`],
];

function preparePatch(root) {
  const appRequire = createRequire(path.join(root, 'package.json'));
  const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
  const manifest = expoRequire.resolve('@expo/cli/package.json');
  const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  if (version !== VERSION) throw new Error(`spark desktop keys require @expo/cli ${VERSION}; found ${version}. Restore the supported version or update the spark Expo patch.`);
  return new Map(patches.map(([relative, hash, before, after]) => {
    const file = fs.realpathSync(path.join(path.dirname(manifest), 'build/src/start', relative));
    const source = fs.readFileSync(file, 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== hash || source.split(before).length !== 2) {
      throw new Error(`Unsupported Expo CLI source: ${relative}. Update the spark Expo patch before starting desktop development.`);
    }
    return [file, source.replace(before, after)];
  }));
}

module.exports = { VERSION, preparePatch };
