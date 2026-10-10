const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const VERSION = '58.1.6';
const extension = JSON.stringify(path.join(__dirname, 'expo-dev-extension.cjs'));
// Process-local patches: installed Expo files remain untouched. Verify the exact
// upstream inputs before starting, so an Expo upgrade cannot silently lose keys.
const patches = [
  ['interface/commandsTable.js', '61b80374e67876d57df4278196c7b31dd13cd6403aa531f6a7ad4c03b7bbf4b2',
    'function logCommandsTable(ui) {',
    `function logCommandsTable(ui) {\n    ui = require(${extension}).integrateCommands(ui);`],
  ['interface/startInterface.js', 'f68d32ad5fe8a7b87c35171959b4d2bf79c0438eadd952059d8e82e409e817c6',
    '    const onPressAsync = async (key)=>{',
    `    const onPressAsync = async (key)=>{\n        try {\n            if (await require(${extension}).handleKey(key)) return;\n        } catch (error) {\n            _log.exception(error);\n            return;\n        }`],
  ['startAsync.js', '8fe56de3c4817f0176891261a42941ad9239082cc66db257591e0a685aaf2aef',
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
