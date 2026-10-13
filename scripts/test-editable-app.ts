import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from '../packages/cli/src/build.ts';
import { readJson, writeJson, stateFile, VERSION } from '../packages/cli/src/project.ts';
import { run } from '../packages/cli/src/commands.ts';
import { spawnProcess } from '../packages/cli/src/process.ts';
import { startFixtureProvider } from './helpers/editable-fixture-provider.ts';
import { installEditableLocally } from './helpers/editable-local.ts';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('bun run test:editable:app [--version 1|2] [--prepare-only] [--no-open] [--real-ai] [--custom-ui]\nBuild a local editable demo, seed its pinned download cache, and open it.\nUse version 2 after applying edits to test migration. Uses a local fake AI provider by default; --real-ai uses your configured provider. --custom-ui demonstrates app-owned prompt/buttons.');
} else {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This demo requires Apple Silicon macOS');
  let version = '1';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version') { version = args[++i]!; if (!['1','2'].includes(version)) throw new Error('Use --version 1 or 2'); }
    else if (!['--prepare-only','--no-open','--real-ai','--custom-ui'].includes(args[i]!)) throw new Error(`Unknown option: ${args[i]}`);
  }
  const framework = path.resolve(import.meta.dirname, '..');
  const root = path.join(framework, '.spark/editable-demo', `v${version}`);
  const marker = path.join(root, '.spark/editable-demo.json');
  if (existsSync(root) && !existsSync(marker)) throw new Error(`Refusing to overwrite an unmarked demo directory: ${root}`);
  mkdirSync(root, { recursive: true });
  writeJson(marker, { managed: true });
  await run(framework, [process.execPath, 'scripts/build-node.mjs'], { capture: true });
  if (!existsSync(path.join(root, 'node_modules'))) symlinkSync(path.join(framework, 'node_modules'), path.join(root, 'node_modules'));
  // Preserve generated package/config fields on reruns so the native build cache remains usable.
  if (!existsSync(path.join(root, 'package.json'))) writeJson(path.join(root, 'package.json'), {
    name: 'spark-editable-demo', version: `${version}.0.0`, private: true, main: 'index.js',
    dependencies: { '@legendapp/spark': VERSION, expo: '54.0.37', react: '19.1.4', 'react-native': '0.81.6', 'react-native-macos': '0.81.7', 'expo-desktop-metro-config': '54.81.0-beta.3' },
  });
  if (!existsSync(path.join(root, 'desktop.config.json'))) writeJson(path.join(root, 'desktop.config.json'), {
    name: 'Spark Editing Demo', version: `${version}.0.0`, projectId: 'be3cc70e-63b8-42d1-95c6-4f527c80eb15', platforms: ['macos'],
    macos: { bundleIdentifier: 'test.spark.editable-demo' },
    editable: { repository: 'local-only/spark-editing-demo', files: ['package.json','desktop.config.json','metro.config.js','index.js','App.js'] },
  });
  const config = readJson(path.join(root, 'desktop.config.json'));
  config.editable.ui = args.includes('--custom-ui') ? 'custom' : 'default';
  config.editable.files = [...new Set([...config.editable.files, 'EditingControls.js'])];
  writeJson(path.join(root, 'desktop.config.json'), config);
  copyFileSync(path.join(framework, 'scripts/helpers/editable-controls.cjs'), path.join(root, 'EditingControls.js'));
  const sources: Record<string, string> = {
    'metro.config.js': 'const path=require("node:path"); const { makeMetroConfig } = require("expo-desktop-metro-config"); const { withDesktop } = require("@legendapp/spark/metro"); const config=withDesktop(makeMetroConfig(__dirname), { runtimes: false }); config.watchFolders=[...config.watchFolders,require("node:fs").realpathSync(path.join(__dirname,"node_modules")),path.dirname(require.resolve("@legendapp/spark/package.json")),path.dirname(require.resolve("@legendapp/spark-desktop-app/package.json"))]; module.exports=config;\n',
    'index.js': 'const { AppRegistry } = require("react-native"); AppRegistry.registerComponent("main", () => require("./App"));\n',
    'App.js': `const React = require('react');
const { View, Text, Pressable } = require('react-native');
module.exports = function App() {
  const [count, setCount] = React.useState(0);
  return React.createElement(View, { style: { flex: 1, padding: 48, backgroundColor: '#fafafa', justifyContent: 'center' } },
    React.createElement(Text, { style: { fontSize: 34, color: '#202020', marginBottom: 18 } }, 'Hello from Spark'),
    React.createElement(Text, { style: { fontSize: 17, color: '#334155', marginBottom: 24 } }, 'Editing demo v${version}. Open Customize app from the Dock menu or press Command–Shift–E.'),
    React.createElement(Pressable, { onPress: () => setCount(count + 1), accessibilityRole: 'button', style: { padding: 16, backgroundColor: '#e0e7ff', borderRadius: 8 } },
      React.createElement(Text, { style: { fontSize: 20, color: '#334155' } }, 'Count: ' + count)),
    ${version === '2' ? "React.createElement(Text, { style: { marginTop: 24, color: '#334155' } }, 'New in version 2: this footer should survive migration')" : 'null'});
};\n`,
  };
  for (const [name, content] of Object.entries(sources)) if (!existsSync(path.join(root, name))) writeFileSync(path.join(root, name), content);
  // This fixture is outside the workspace roots: index its shared dependencies and linked packages.
  // The marked fixture owns its entry wrapper; app source and accepted edits stay separate.
  writeFileSync(path.join(root, 'metro.config.js'), sources['metro.config.js']!);
  writeFileSync(path.join(root, 'index.js'), args.includes('--custom-ui') ? `const React=require('react');const {AppRegistry,View}=require('react-native');const App=require('./App');const Controls=require('./EditingControls');function Demo(){return React.createElement(View,{style:{flex:1}},React.createElement(App),React.createElement(Controls));}AppRegistry.registerComponent('main',()=>Demo);\n` : sources['index.js']!);
  console.log(`Demo source: ${root}\nEdits are saved separately under ~/Library/Application Support/test.spark.editable-demo/SparkEditable`);
  if (!args.includes('--prepare-only')) {
    // This fixture shares the workspace installation, where Expo CLI need not be hoisted.
    const previousCLI = process.env.CLI_PATH;
    process.env.CLI_PATH = path.join(path.dirname(createRequire(path.join(root, 'package.json')).resolve('expo/package.json')), 'bin/cli');
    let result;
    try { result = await build(root, 'release', false); }
    finally { if (previousCLI === undefined) delete process.env.CLI_PATH; else process.env.CLI_PATH = previousCLI; }
    const manifest = readJson(path.join(result.app, 'Contents/Resources/spark-editable.json'));
    await installEditableLocally(manifest, stateFile(root, 'editable'), path.join(os.homedir(), 'Library/Application Support/Legend Spark/EditingToolkits'));
    const entry = args.includes('--custom-ui') ? 'Use the app-owned prompt and buttons' : 'Open Customize app (Command–Shift–E)';
    console.log(`Local app: ${result.app}\nNo GitHub publication needed.\n1. ${entry} and enter: Make the greeting blue.\n2. Generate, then ask: Make the greeting larger. Review must show both edits.\n3. Preview, Apply, quit and rerun this command: the customization should persist.\n4. Quit and run with --version 2. Open Provider settings if using custom controls. Choose Migrate edits, Review, and Apply; the new footer and your greeting changes should remain.\n5. Choose Original to restore the shipped demo.`);
    if (!args.includes('--no-open')) {
      const executable = (await run(root, ['/usr/libexec/PlistBuddy','-c','Print CFBundleExecutable',path.join(result.app, 'Contents/Info.plist')], { capture: true })).trim();
      const fixture = args.includes('--real-ai') ? undefined : await startFixtureProvider(path.join(root, '.spark/fake-ai'));
      let app: ReturnType<typeof spawnProcess> | undefined;
      let stopped = false;
      const stop = () => {
        stopped = true;
        if (app?.pid) try { process.kill(-app.pid, 'SIGTERM'); } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
      };
      try {
        const options = fixture ? ['-SparkEditableEndpoint', fixture.endpoint, '-SparkEditableModel', 'local-fixture'] : [];
        console.log(fixture ? 'Fake AI is running locally. No API key or external AI service is needed. Supported edits: blue greeting, larger greeting.' : 'Using your configured AI provider; requests may incur charges.');
        app = spawnProcess([path.join(result.app, 'Contents/MacOS', executable), ...options], { cwd: root, env: { ...process.env, ...(fixture ? { NODE_EXTRA_CA_CERTS: fixture.certificate } : {}) }, stdout: 'inherit', stderr: 'inherit', detached: true });
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
        console.log('Quit the demo or press Ctrl+C to stop the local test.');
        const code = await app.exited;
        if (code && !stopped) throw new Error(`Demo exited with code ${code}`);
      } finally {
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
        if (app) { stop(); await app.exited; }
        await fixture?.close();
      }
    }
  }
}
