import { it, expect } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { prepareEditableArtifacts } from '../packages/cli/src/editable-artifacts.ts';
import { run } from '../packages/cli/src/commands.ts';
import { nativePackages, readJson, VERSION, writeJson } from '../packages/cli/src/project.ts';
import { installEditableLocally } from '../scripts/helpers/editable-local.ts';
import { startFixtureProvider } from '../scripts/helpers/editable-fixture-provider.ts';
import { runtimes } from './helpers/js-runtimes.ts';
const require = createRequire(import.meta.url);
it.skipIf(process.env.SPARK_TEST_EDITABLE !== '1' || process.platform !== 'darwin')('runs fake-prompt edits through relocated tooling and production Hermes on both runtimes', async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'spark-editable-integration-'));
  try {
    const root = path.join(temporary, 'publisher'), app = path.join(root, 'Test.app'); mkdirSync(root);
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
    writeJson(path.join(root, 'package.json'), { name: 'editable-test', private: true, main: 'index.js', dependencies: { '@legendapp/spark': VERSION, expo: '54.0.37', react: '19.1.4', 'react-native': '0.81.6', 'react-native-macos': '0.81.7', 'expo-desktop-metro-config': '54.81.0-beta.3' } });
    const files = ['package.json', 'desktop.config.json', 'metro.config.js', 'index.js', 'pixel.png'];
    writeJson(path.join(root, 'desktop.config.json'), { name: 'Editable Test', version: '1.0.0', projectId: 'test.spark.editable', macos: { bundleIdentifier: 'test.spark.editable' }, platforms: ['macos'], editable: { repository: 'test/app', files } });
    writeFileSync(path.join(root, 'metro.config.js'), 'const { makeMetroConfig } = require("expo-desktop-metro-config"); const { withDesktop } = require("@legendapp/spark/metro"); module.exports=withDesktop(makeMetroConfig(__dirname), {runtimes:false});\n');
    writeFileSync(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=', 'base64'));
    writeFileSync(path.join(root, 'index.js'), 'const React = require("react"); const {AppRegistry,Text,Image,View}=require("react-native"); AppRegistry.registerComponent("main",()=>()=>React.createElement(View,null,React.createElement(Text,null,"Editable original"),React.createElement(Image,{source:require("./pixel.png")})));\n');
    const modules = Object.fromEntries(nativePackages(root).map(pkg => [pkg.name, pkg.signature]));
    const runtime = { schema: 1 as const, platform: 'macos' as const, arch: 'arm64' as const, mode: 'release', fingerprint: 'a'.repeat(64), framework: VERSION, modules };
    const manifest = (await prepareEditableArtifacts(root, runtime, app))!;
    expect(manifest.source.size).toBeGreaterThan(100); expect(manifest.toolkit.size).toBeLessThan(2 * 1024 ** 3);
    const installed = await installEditableLocally(manifest, path.join(root, '.spark/editable'), path.join(temporary, 'cache'));
    renameSync(root, path.join(temporary, 'publisher-offline'));
    const toolkit = installed.toolkit!, worker = require(path.join(toolkit, 'editable-worker.cjs'));
    const dir = worker.prepare(manifest, installed.source, toolkit, path.join(temporary, 'support'));
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
    const provider = await startFixtureProvider(path.join(temporary, 'provider'), 'index.js');
    try {
      // Add an editable style target, then exercise the same HTTPS fixture used by the interactive demo.
      writeFileSync(path.join(dir, 'work/index.js'), readFileSync(path.join(dir, 'work/index.js'), 'utf8') + "\nconst demoStyle = { color: '#202020', fontSize: 34 };\n");
      for (const engine of runtimes) {
        const prompt = engine.name === 'bun' ? 'Make the greeting larger' : 'Make the greeting blue';
        const request = path.join(temporary, 'request.json');
        writeJson(request, { prompt, endpoint: provider.endpoint, model: 'local-fixture', allowSourceSharing: true });
        await run(dir, [engine.executable, path.join(toolkit, 'editable-worker.cjs'), 'prompt', dir, request], { env: { SPARK_JS_RUNTIME: engine.executable, NODE_EXTRA_CA_CERTS: provider.certificate }, capture: true });
      }
      const review = readFileSync(path.join(dir, 'review.txt'), 'utf8');
      expect(review).toContain("color: '#2563eb'"); expect(review).toContain('fontSize: 48');
      worker.accept(dir);
      expect(readFileSync(path.join(dir, 'work/index.js'), 'utf8')).toContain("color: '#2563eb', fontSize: 48");
    } finally { await provider.close(); }
    // Exercise actual CLI subprocesses and production compilation after relocation.
    const bin = path.join(temporary, 'cli-bin'); mkdirSync(bin);
    for (const engine of runtimes) {
      const tool = engine.name === 'node' ? 'codex' : 'claude', executable = path.join(bin, tool);
      writeFileSync(executable, `#!${engine.executable}\nconst fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const body=JSON.parse(input.slice(input.indexOf('\\n')+1));const replies=body.messages.filter(item=>item.role==='tool');const call=(name,args)=>({content:'',tool_calls:[{id:String(replies.length),function:{name,arguments:JSON.stringify(args)}}]});const message=replies.length===0?call('read_file',{path:'index.js'}):replies.length===1?call('write_file',{path:'index.js',content:JSON.parse(replies[0].content).replace(/(?:Custom greeting|CLI greeting node)/g,'CLI greeting ${engine.name}')}):{content:'Changed greeting via CLI',tool_calls:[]};const out=process.argv.indexOf('--output-last-message');if(out>=0)fs.writeFileSync(process.argv[out+1],JSON.stringify(message));else console.log(JSON.stringify({structured_output:message}));});\n`); chmodSync(executable, 0o755);
      const request = path.join(temporary, 'cli-request.json');
      writeJson(request, { prompt: `Change greeting using ${tool}`, provider: 'cli', tool, allowSourceSharing: true });
      await run(dir, [engine.executable, path.join(toolkit, 'editable-worker.cjs'), 'prompt', dir, request], { capture: true, env: { SPARK_JS_RUNTIME: engine.executable, PATH: bin + path.delimiter + process.env.PATH } });
      const ready = readJson(path.join(dir, 'ready.json')); expect(readFileSync(path.join(dir, 'builds', ready.build, 'main.jsbundle')).subarray(0,8).toString('hex')).toBe('c61fbc03c103191f');
      worker.accept(dir);
      expect(readFileSync(path.join(dir, 'work/index.js'), 'utf8')).toContain(`CLI greeting ${engine.name}`);
      expect(readJson(path.join(dir, 'state.json')).history.at(-1).provider).toBe(`cli:${tool}`);
    }
    console.log(`Editable toolkit: ${manifest.toolkit.size} bytes compressed; source: ${manifest.source.size} bytes`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 600000);
