import { it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { prepareEditableArtifacts } from '../packages/cli/src/editable-artifacts.ts';
import { run } from '../packages/cli/src/commands.ts';
import { nativePackages, readJson, VERSION, writeJson } from '../packages/cli/src/project.ts';
import { runtimes } from './helpers/js-runtimes.ts';
const require = createRequire(import.meta.url);
it.skipIf(process.env.SPARK_TEST_EDITABLE !== '1' || process.platform !== 'darwin')('rebuilds a relocated production bundle with both runtimes and preserves prompts through updates', async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'spark-editable-integration-'));
  try {
    const root = path.join(temporary, 'publisher'), app = path.join(root, 'Test.app'); mkdirSync(root);
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
    writeJson(path.join(root, 'package.json'), { name: 'editable-test', private: true, main: 'index.js', dependencies: { '@legendapp/spark': VERSION, expo: '54.0.37', react: '19.1.4', 'react-native': '0.81.6', 'expo-desktop-metro-config': '54.81.0-beta.3' } });
    const files = ['package.json', 'desktop.config.json', 'metro.config.js', 'index.js', 'pixel.png'];
    writeJson(path.join(root, 'desktop.config.json'), { name: 'Editable Test', version: '1.0.0', projectId: 'test.spark.editable', macos: { bundleIdentifier: 'test.spark.editable' }, platforms: ['macos'], editable: { repository: 'test/app', files } });
    writeFileSync(path.join(root, 'metro.config.js'), 'const { makeMetroConfig } = require("expo-desktop-metro-config"); const { withDesktop } = require("@legendapp/spark/metro"); module.exports=withDesktop(makeMetroConfig(__dirname), {runtimes:false});\n');
    writeFileSync(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=', 'base64'));
    writeFileSync(path.join(root, 'index.js'), 'const React = require("react"); const {AppRegistry,Text,Image,View}=require("react-native"); AppRegistry.registerComponent("main",()=>()=>React.createElement(View,null,React.createElement(Text,null,"Editable original"),React.createElement(Image,{source:require("./pixel.png")})));\n');
    const modules = Object.fromEntries(nativePackages(root).map(pkg => [pkg.name, pkg.signature]));
    const runtime = { schema: 1 as const, platform: 'macos' as const, arch: 'arm64' as const, mode: 'release', fingerprint: 'a'.repeat(64), framework: VERSION, modules };
    const manifest = (await prepareEditableArtifacts(root, runtime, app))!;
    expect(manifest.source.size).toBeGreaterThan(100); expect(manifest.toolkit.size).toBeLessThan(2 * 1024 ** 3);
    const extracted = path.join(temporary, 'downloaded'); mkdirSync(extracted);
    for (const asset of [manifest.source, manifest.toolkit]) await run(root, ['/usr/bin/tar', '-xzf', path.join(root, '.spark/editable', new URL(asset.url).pathname.split('/').at(-1)!), '-C', extracted], { capture: true });
    // Removing access to publisher files makes accidental absolute-path dependencies fail.
    renameSync(root, path.join(temporary, 'publisher-offline'));
    const toolkit = path.join(extracted, 'toolkit'), worker = require(path.join(toolkit, 'editable-worker.cjs'));
    const dir = worker.prepare(manifest, path.join(extracted, 'source'), toolkit, path.join(temporary, 'support'));
    for (const engine of runtimes) {
      await run(dir, [engine.executable, path.join(toolkit, 'editable-worker.cjs'), 'build', dir], { env: { SPARK_JS_RUNTIME: engine.executable }, capture: true });
      const ready = readJson(path.join(dir, 'ready.json'));
      expect(readFileSync(path.join(dir, 'builds', ready.build, 'main.jsbundle')).subarray(0,8).toString('hex')).toBe('c61fbc03c103191f');
      expect(readdirSync(path.join(dir, 'builds', ready.build), { recursive: true }).some(name => String(name).endsWith('.png'))).toBe(true);
      worker.accept(dir);
    }
    const ai = require(path.join(toolkit, 'editable-ai.cjs'));
    let call = 0;
    await ai.prompt(dir, { prompt: 'Change the greeting to Custom greeting', endpoint: 'https://example.test/chat/completions', model: 'fixture', allowSourceSharing: true }, { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++call === 1 ? { tool_calls: [{ id: 'change', function: { name: 'write_file', arguments: JSON.stringify({ path: 'index.js', content: readFileSync(path.join(dir, 'work/index.js'), 'utf8').replace('Editable original', 'Custom greeting') }) } }] } : { content: 'Updated greeting' } }] }) }) });
    worker.accept(dir);
    expect(readJson(path.join(dir, 'state.json')).history.at(-1).prompt).toContain('Custom greeting');
    console.log(`Editable toolkit: ${manifest.toolkit.size} bytes compressed; source: ${manifest.source.size} bytes`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 600000);
