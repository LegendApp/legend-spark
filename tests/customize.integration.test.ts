import { it, expect } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { prepareCustomizeArtifacts } from '../packages/cli/src/customize-artifacts.ts';
import { run } from '../packages/cli/src/commands.ts';
import { nativePackages, readJson, VERSION, writeJson } from '../packages/cli/src/project.ts';
import { installCustomizeLocally } from '../scripts/helpers/customize-local.ts';
import { startFixtureProvider } from '../scripts/helpers/customize-fixture-provider.ts';
import { runtimes } from './helpers/js-runtimes.ts';
const require = createRequire(import.meta.url);
it.skipIf(process.env.SPARK_TEST_CUSTOMIZE !== '1' || process.platform !== 'darwin').each(['flat', 'monorepo'])('runs %s fake-prompt edits through relocated tooling and production Hermes on both runtimes', async layout => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'spark-customize-integration-'));
  try {
    const publisher = path.join(temporary, 'publisher'), root = layout === 'monorepo' ? path.join(publisher, 'apps/demo') : publisher;
    const app = path.join(root, 'Test.app'), sourcePath = layout === 'monorepo' ? 'apps/demo/index.js' : 'index.js';
    mkdirSync(root, { recursive: true });
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
    writeJson(path.join(root, 'package.json'), { name: 'customize-test', private: true, main: 'index.js', dependencies: { '@legendapp/spark': VERSION, expo: '54.0.37', react: '19.1.4', 'react-native': '0.81.6', 'react-native-macos': '0.81.7', 'expo-desktop-metro-config': '54.81.3' } });
    const files = ['package.json', 'desktop.config.json', 'metro.config.js', 'index.js', 'pixel.png'];
    writeJson(path.join(root, 'desktop.config.json'), { name: 'Customize Test', version: '1.0.0', projectId: 'test.spark.customize', macos: { bundleIdentifier: 'test.spark.customize' }, platforms: ['macos'], customize: { repository: 'test/app', files: layout === 'monorepo' ? ['apps/demo/index.js', 'apps/demo/pixel.png', 'packages/shared'] : files, ...(layout === 'monorepo' ? { sourceRoot: '../..' } : {}) } });
    writeFileSync(path.join(root, 'metro.config.js'), 'const { makeMetroConfig } = require("expo-desktop-metro-config"); const { withDesktop } = require("@legendapp/spark/metro"); module.exports=withDesktop(makeMetroConfig(__dirname), {runtimes:false});\n');
    writeFileSync(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=', 'base64'));
    writeFileSync(path.join(root, 'index.js'), 'const React = require("react"); const {AppRegistry,Text,Image,View}=require("react-native"); AppRegistry.registerComponent("main",()=>()=>React.createElement(View,null,React.createElement(Text,null,"Customize original"),React.createElement(Image,{source:require("./pixel.png")})));\n');
    if (layout === 'monorepo') {
      const shared = path.join(publisher, 'packages/shared/greeting.js');
      mkdirSync(path.dirname(shared), { recursive: true }); writeFileSync(shared, 'module.exports = "Shared greeting";\n');
      writeFileSync(path.join(root, 'index.js'), readFileSync(path.join(root, 'index.js'), 'utf8') + `\nconst sharedGreeting = require(${JSON.stringify(shared)});\n`);
      writeFileSync(path.join(root, 'metro.config.js'), 'const path=require("node:path"); const { makeMetroConfig } = require("expo-desktop-metro-config"); const { withDesktop } = require("@legendapp/spark/metro"); const config=withDesktop(makeMetroConfig(__dirname), {runtimes:false}); config.watchFolders=[...config.watchFolders,path.resolve(__dirname,"../..")]; module.exports=config;\n');
    }
    const modules = Object.fromEntries(nativePackages(root).map(pkg => [pkg.name, pkg.signature]));
    const runtime = { schema: 1 as const, platform: 'macos' as const, arch: 'arm64' as const, mode: 'release', fingerprint: 'a'.repeat(64), framework: VERSION, modules };
    const manifest = (await prepareCustomizeArtifacts(root, runtime, app))!;
    expect(manifest.source.size).toBeGreaterThan(100); expect(manifest.toolkit.size).toBeLessThan(2 * 1024 ** 3);
    const installed = await installCustomizeLocally(manifest, path.join(root, '.spark/customize'), path.join(temporary, 'cache'));
    renameSync(publisher, path.join(temporary, 'publisher-offline'));
    const toolkit = installed.toolkit!, worker = require(path.join(toolkit, 'customize-worker.cjs'));
    const dir = worker.prepare(manifest, installed.source, toolkit, path.join(temporary, 'support'));
    for (const engine of runtimes) {
      await run(dir, [engine.executable, path.join(toolkit, 'customize-worker.cjs'), 'build', dir], { env: { SPARK_JS_RUNTIME: engine.executable }, capture: true });
      const ready = readJson(path.join(dir, 'ready.json'));
      expect(readFileSync(path.join(dir, 'builds', ready.build, 'main.jsbundle')).subarray(0,8).toString('hex')).toBe('c61fbc03c103191f');
      expect(readdirSync(path.join(dir, 'builds', ready.build), { recursive: true }).some(name => String(name).endsWith('.png'))).toBe(true);
      worker.accept(dir);
    }
    const ai = require(path.join(toolkit, 'customize-ai.cjs'));
    let call = 0;
    await ai.prompt(dir, { prompt: 'Change the greeting to Custom greeting', endpoint: 'https://example.test/chat/completions', model: 'fixture', allowSourceSharing: true }, { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++call === 1 ? { tool_calls: [{ id: 'change', function: { name: 'write_file', arguments: JSON.stringify({ path: sourcePath, content: readFileSync(path.join(dir, 'work', sourcePath), 'utf8').replace('Customize original', 'Custom greeting') }) } }] } : { content: 'Updated greeting' } }] }) }) });
    worker.accept(dir);
    expect(readJson(path.join(dir, 'state.json')).history.at(-1).prompt).toContain('Custom greeting');
    const provider = await startFixtureProvider(path.join(temporary, 'provider'), sourcePath);
    try {
      // Add an editable style target, then exercise the same HTTPS fixture used by the interactive demo.
      writeFileSync(path.join(dir, 'work', sourcePath), readFileSync(path.join(dir, 'work', sourcePath), 'utf8') + "\nconst demoStyle = { color: '#202020', fontSize: 34 };\n");
      for (const engine of runtimes) {
        const prompt = engine.name === 'bun' ? 'Make the greeting larger' : 'Make the greeting blue';
        const request = path.join(temporary, 'request.json');
        writeJson(request, { prompt, endpoint: provider.endpoint, model: 'local-fixture', allowSourceSharing: true });
        await run(dir, [engine.executable, path.join(toolkit, 'customize-worker.cjs'), 'prompt', dir, request], { env: { SPARK_JS_RUNTIME: engine.executable, NODE_EXTRA_CA_CERTS: provider.certificate }, capture: true });
      }
      const review = readFileSync(path.join(dir, 'review.txt'), 'utf8');
      expect(review).toContain("color: '#2563eb'"); expect(review).toContain('fontSize: 48');
      worker.accept(dir);
      expect(readFileSync(path.join(dir, 'work', sourcePath), 'utf8')).toContain("color: '#2563eb', fontSize: 48");
    } finally { await provider.close(); }
    // Exercise actual CLI subprocesses and production compilation after relocation.
    const bin = path.join(temporary, 'cli-bin'); mkdirSync(bin);
    const cliRunner = path.join(temporary, 'cli-runner.cjs');
    writeFileSync(cliRunner, `const fs=require('node:fs'); const ai=require(${JSON.stringify(path.join(toolkit, 'customize-ai.cjs'))}); ai.prompt(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8'))).catch(error=>{console.error(error);process.exitCode=1});\n`);
    for (const engine of runtimes) {
      const tool = engine.name === 'node' ? 'codex' : 'claude', executable = path.join(bin, tool);
      const invoked = path.join(temporary, `invoked-${tool}`);
      writeFileSync(executable, `#!${engine.executable}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(invoked)},'fixture');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const body=JSON.parse(input.slice(input.indexOf('\\n')+1));const replies=body.messages.filter(item=>item.role==='tool');const call=(name,args)=>({content:'',tool_calls:[{id:String(replies.length),function:{name,arguments:JSON.stringify(args)}}]});const message=replies.length===0?call('read_file',{path:${JSON.stringify(sourcePath)}}):replies.length===1?call('write_file',{path:${JSON.stringify(sourcePath)},content:JSON.parse(replies[0].content).replace(/(?:Custom greeting|CLI greeting node)/g,'CLI greeting ${engine.name}')}):{content:'Changed greeting via CLI',tool_calls:[]};const out=process.argv.indexOf('--output-last-message');if(out>=0)fs.writeFileSync(process.argv[out+1],JSON.stringify(message));else console.log(JSON.stringify({structured_output:message}));});\n`); chmodSync(executable, 0o755);
      const request = path.join(temporary, 'cli-request.json');
      writeJson(request, { prompt: `Change greeting using ${tool}`, provider: 'cli', tool, allowSourceSharing: true });
      await run(dir, [engine.executable, cliRunner, dir, request], { capture: true, env: { PATH: bin + path.delimiter + process.env.PATH } });
      expect(readFileSync(invoked, 'utf8')).toBe('fixture');
      const ready = readJson(path.join(dir, 'ready.json')); expect(readFileSync(path.join(dir, 'builds', ready.build, 'main.jsbundle')).subarray(0,8).toString('hex')).toBe('c61fbc03c103191f');
      worker.accept(dir);
      expect(readFileSync(path.join(dir, 'work', sourcePath), 'utf8')).toContain(`CLI greeting ${engine.name}`);
      expect(readJson(path.join(dir, 'state.json')).history.at(-1).provider).toBe(`cli:${tool}`);
    }
    console.log(`Customize toolkit: ${manifest.toolkit.size} bytes compressed; source: ${manifest.source.size} bytes`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 600000);
