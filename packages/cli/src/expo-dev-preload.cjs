const Module = require('node:module');
const { preparePatch } = require('./expo-dev-patch.cjs');

// Node forks inherit --require, including Metro transform workers. Only the
// top-level Expo process may attach to the Spark supervisor's IPC channel.
if (!process.env.SPARK_EXPO_PRELOADED) {
  process.env.SPARK_EXPO_PRELOADED = '1';
  if (!process.send) throw new Error('Start the Spark Expo integration through spark dev.');
  // Expo 55 binds --localhost to "localhost", which Node resolves to ::1 first;
  // desktop runtimes and Spark's Metro clients connect to 127.0.0.1.
  require('node:dns').setDefaultResultOrder('ipv4first');
  const patches = preparePatch(process.cwd());
  const load = Module._extensions['.js'];
  Module._extensions['.js'] = function(module, filename) {
    const source = patches.get(filename);
    if (source === undefined) return load(module, filename);
    patches.delete(filename);
    if (!patches.size) Module._extensions['.js'] = load;
    module._compile(source, filename);
  };
  require('./expo-dev-extension.cjs');
}
