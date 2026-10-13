import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { copySource, copyDependencies, prepareSource, githubAsset, fileHash, publishEditable } from '../packages/cli/src/editable-artifacts.ts';
const require = createRequire(import.meta.url);
const { validateEditable } = require('../packages/config-plugin/editable.cjs');
const worker = require('../packages/cli/src/editable-worker.cjs');
const ai = require('../packages/cli/src/editable-ai.cjs');
const b64 = (text: string) => Buffer.from(text).toString('base64');
let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-editable-test-'))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function file(name: string, value: string) { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, value); return target; }
const asset = { url: 'https://github.com/owner/app/releases/download/v1/source.tgz', sha256: 'a'.repeat(64), size: 100 };
function manifest(release = 'a') { return { schema: 1, project: 'app.test', version: '1.0', release: release.repeat(64), entry: 'index.js', source: asset, toolkit: asset, runtime: { schema: 1, platform: 'macos', mode: 'release', framework: '1', modules: {}, fingerprint: 'f' } }; }
function workspace(release = 'a', source = 'original\n') {
  const folder = path.join(root, 'source-' + release); mkdirSync(folder); writeFileSync(path.join(folder, 'index.js'), source);
  return worker.prepare(manifest(release), folder, path.join(root, 'toolkit'), path.join(root, 'support'));
}
describe('editable release inputs', () => {
  it('requires explicit source and fixed GitHub release identity', () => {
    expect(validateEditable(false)).toBeUndefined();
    expect(validateEditable({ repository: 'owner/app', files: ['src', 'package.json'] })).toBeTruthy();
    for (const files of [['../secret'], ['.env'], ['/tmp'], ['src/../secret'], ['node_modules'], ['macos']]) expect(() => validateEditable({ repository: 'owner/app', files })).toThrow();
    expect(() => githubAsset('owner/app', '../main', 'x')).toThrow();
  });
  it('rejects source links and credentials', () => {
    file('src/index.js', 'ok'); file('src/secret.key', 'private');
    expect(() => copySource(root, path.join(root, 'out'), ['src'])).toThrow('credentials');
    symlinkSync(path.join(root, 'src'), path.join(root, 'linked'));
    expect(() => copySource(root, path.join(root, 'out'), ['linked'])).toThrow('symlink');
    expect(() => copySource(root, path.join(root, 'out'), ['linked/index.js'])).toThrow('symlink');
  });
  it('preserves nested conflicting dependency versions after relocation', async () => {
    file('project/package.json', JSON.stringify({ dependencies: { a: '1', x: '1' } }));
    file('project/node_modules/a/package.json', JSON.stringify({ name: 'a', version: '1', dependencies: { x: '2' } }));
    file('project/node_modules/a/index.js', "module.exports = require('x');");
    file('project/node_modules/a/node_modules/x/package.json', JSON.stringify({ name: 'x', version: '2' }));
    file('project/node_modules/a/node_modules/x/index.js', "module.exports = 2;");
    file('project/node_modules/x/package.json', JSON.stringify({ name: 'x', version: '1' }));
    file('project/node_modules/x/index.js', "module.exports = 1;");
    const target = path.join(root, 'relocated');
    await copyDependencies(path.join(root, 'project'), target);
    rmSync(path.join(root, 'project'), { recursive: true });
    const req = createRequire(path.join(target, 'package.json'));
    expect(req('a')).toBe(2); expect(req('x')).toBe(1);
  });
});
describe('repository source snapshots', () => {
  function project(entry = 'import App from ' + JSON.stringify(path.join(root, 'repo/apps/demo/src/App.js')) + ';') {
    file('repo/.legend/demo/package.json', JSON.stringify({ main: 'index.ts' }));
    file('repo/.legend/demo/desktop.config.json', '{}');
    file('repo/.legend/demo/index.ts', entry);
    file('repo/.legend/demo/babel.config.js', 'module.exports = require(' + JSON.stringify(path.join(root, 'repo/shell/babel.config.js')) + ');');
    file('repo/.legend/demo/metro.config.js', 'module.exports = { watchFolders: [' + JSON.stringify(path.join(root, 'repo')) + '], app: ' + JSON.stringify(path.join(root, 'repo/apps/demo/src')) + ' };');
    file('repo/shell/babel.config.js', 'const path = require("node:path"); const appId = "demo"; const appConfigPath = appId && path.join(__dirname, "../apps", appId, "babel.config.cjs"); module.exports = require(appConfigPath);');
    file('repo/apps/demo/babel.config.cjs', 'module.exports = { plugins: [] };');
    file('repo/apps/demo/src/App.js', 'module.exports = 1;');
    file('repo/packages/shared/index.js', 'module.exports = 2;');
    return path.join(root, 'repo/.legend/demo');
  }
  it('validates ancestor source roots without permitting arbitrary external layouts', () => {
    expect(validateEditable({ repository: 'owner/app', files: ['apps/demo/src'], sourceRoot: '../..', githubClientId: 'Ov23test' })).toBeTruthy();
    for (const sourceRoot of ['/tmp', '../another-repo', '', 'a/..']) expect(() => validateEditable({ repository: 'owner/app', files: ['src'], sourceRoot })).toThrow('sourceRoot');
    expect(() => validateEditable({ repository: 'owner/app', files: ['src'], githubClientId: '' })).toThrow('githubClientId');
  });
  it('preserves shared source paths and relocates generated imports and build config', () => {
    const app = project(), target = path.join(root, 'snapshot');
    const layout = prepareSource(app, target, ['apps/demo', 'shell', 'packages/shared'], '../..');
    expect(layout).toEqual({ sourceRoot: path.join(root, 'repo'), projectRoot: '.legend/demo', entry: 'index.ts' });
    const entry = readFileSync(path.join(target, '.legend/demo/index.ts'), 'utf8');
    expect(entry).toContain('"../../apps/demo/src/App.js"'); expect(entry).not.toContain(root);
    rmSync(path.join(root, 'repo'), { recursive: true });
    const req = createRequire(path.join(target, '.legend/demo/package.json'));
    expect(req('./babel.config.js')).toEqual({ plugins: [] });
    expect(req('./metro.config.js')).toEqual({ watchFolders: [target], app: path.join(target, 'apps/demo/src') });
    expect(existsSync(path.join(target, 'packages/shared/index.js'))).toBe(true);
    const trusted = require('../packages/cli/src/editable-policy.cjs').collectTrustedFiles(target);
    expect(trusted).toContain('shell/babel.config.js');
    expect(trusted).toContain('apps/demo/babel.config.cjs');
    expect(trusted).not.toContain('apps/demo/src/App.js');
  });
  it('rejects publisher paths outside the snapshot and interpolated absolute paths', () => {
    const app = project('import App from "/Users/publisher/elsewhere/App.js";');
    expect(() => prepareSource(app, path.join(root, 'outside'), ['apps/demo/src', 'shell'], '../..')).toThrow('outside sourceRoot');
    writeFileSync(path.join(app, 'index.ts'), 'const location = `' + path.join(root, 'repo') + '/${name}`;');
    expect(() => prepareSource(app, path.join(root, 'dynamic'), ['apps/demo/src', 'shell'], '../..')).toThrow('literal paths');
    writeFileSync(path.join(app, 'index.ts'), 'const location = ' + JSON.stringify(path.join(root, 'repo/apps/demo/src')) + ';');
    expect(() => prepareSource(app, path.join(root, 'runtime-path'), ['apps/demo', 'shell'], '../..')).toThrow('absolute runtime paths');
    writeFileSync(path.join(app, 'index.ts'), 'import App from ' + JSON.stringify(path.join(root, 'repo/apps/demo/src/App.js')) + ';');
    expect(() => prepareSource(app, path.join(root, 'missing'), ['shell'], '../..')).toThrow('Missing import');
  });
  it('keeps ESM Metro config portable when a snapshot path contains spaces', async () => {
    const app = project(), target = path.join(root, 'snapshot with spaces');
    rmSync(path.join(app, 'metro.config.js'));
    file('repo/.legend/demo/metro.config.mjs', 'export default { root: ' + JSON.stringify(path.join(root, 'repo')) + ' };');
    prepareSource(app, target, ['apps/demo', 'shell'], '../..');
    expect((await import(pathToFileURL(path.join(target, '.legend/demo/metro.config.mjs')).href)).default).toEqual({ root: target });
  });
  it('builds a relocated nested project using shared source and the toolkit dependency tree', async () => {
    const app = project(), source = path.join(root, 'source');
    const layout = prepareSource(app, source, ['apps/demo', 'shell'], '../..');
    const toolkit = path.join(root, 'toolkit');
    file('toolkit/node_modules/expo/package.json', JSON.stringify({ name: 'expo', bin: { expo: 'cli.cjs' } }));
    file('toolkit/node_modules/expo/cli.cjs', `const fs = require('node:fs'), path = require('node:path');
const args = process.argv; const output = args[args.indexOf('--bundle-output') + 1], map = args[args.indexOf('--sourcemap-output') + 1];
if (!fs.existsSync(path.resolve('../../apps/demo/src/App.js'))) throw new Error('Shared source missing');
if (!require(path.resolve('babel.config.js')).plugins) throw new Error('Config missing');
fs.writeFileSync(output, 'compiled'); fs.writeFileSync(map, JSON.stringify({ sources: ['../../apps/demo/src/App.js'] }));`);
    const compiler = file('toolkit/hermesc', '#!/bin/sh\ncp "$5" "$4"\n'); chmodSync(compiler, 0o755);
    file('toolkit/toolkit.json', JSON.stringify({ arch: process.arch, framework: '1', compiler: fileHash(compiler) }));
    const dir = worker.prepare({ ...manifest(), projectRoot: layout.projectRoot }, source, toolkit, path.join(root, 'support'));
    rmSync(path.join(root, 'repo'), { recursive: true });
    const result = await worker.build(dir);
    expect(existsSync(path.join(dir, 'builds', result.build, 'main.jsbundle'))).toBe(true);
    expect(worker.verify(dir).candidate).toBe('work');
    expect(worker.read(path.join(dir, 'builds', result.build, 'runtime-sources.json')).roots).toEqual([path.join(dir, 'work/apps/demo/src/App.js')]);
  });
});
describe('three-way migrations', () => {
  it('combines independent changes and rejects overlapping edits', () => {
    expect(worker.mergeText('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n')).toBe('A\nb\nC\n');
    expect(worker.mergeText('a\nb\n', 'A\nb\n', 'other\nb\n')).toBeUndefined();
    expect(worker.mergeText('a\n', 'A\n', 'A\n')).toBe('A\n');
  });
  it('preserves deletions and reports binary and add/add conflicts', () => {
    const result = worker.merge({ gone: b64('a'), binary: 'AA==' }, { binary: 'AQ==', added: b64('mine') }, { gone: b64('a'), binary: 'Ag==', added: b64('theirs') });
    expect(result.files.gone).toBeUndefined(); expect(result.conflicts).toEqual(['added', 'binary']);
  });
  it('keeps old edits and stores intent with a separate migration candidate', () => {
    const old = workspace('a', 'a\nb\n'), next = workspace('b', 'a\nB\n');
    writeFileSync(path.join(old, 'work/index.js'), 'A\nb\n');
    const state = worker.read(path.join(old, 'state.json')); state.history.push({ prompt: 'Capitalize the first line', status: 'accepted', patch: [] }); worker.write(path.join(old, 'state.json'), state);
    const result = worker.migrate(old, next);
    expect(readFileSync(path.join(next, 'candidates', result.candidate, 'index.js'), 'utf8')).toBe('A\nB\n');
    expect(readFileSync(path.join(next, 'work/index.js'), 'utf8')).toBe('a\nB\n');
    expect(readFileSync(path.join(old, 'work/index.js'), 'utf8')).toBe('A\nb\n');
    expect(worker.read(path.join(next, 'migration.json')).prompts[0].prompt).toBe('Capitalize the first line');
    expect(() => worker.migrate(old, next)).toThrow('already');
  });
  it('preparing an existing release never overwrites user files', () => {
    const dir = workspace(); writeFileSync(path.join(dir, 'work/index.js'), 'custom');
    worker.prepare(manifest(), path.join(root, 'source-a'), path.join(root, 'toolkit'), path.join(root, 'support'));
    expect(readFileSync(path.join(dir, 'work/index.js'), 'utf8')).toBe('custom');
  });
});
describe('prompt editing', () => {
  const request = { prompt: 'Make it blue', endpoint: 'https://example.test/v1/chat/completions', model: 'test', allowSourceSharing: true };
  it('records the exact prompt, base release and patch without activating edits', async () => {
    const dir = workspace(); let call = 0;
    const result = await ai.prompt(dir, request, { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++call === 1 ? { tool_calls: [{ id: '1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'index.js', content: 'blue\n' }) } }] } : { content: 'Changed to blue' } }] }) }), build: async () => {} });
    const event = worker.read(path.join(dir, 'state.json')).history[0];
    expect(event.prompt).toBe(request.prompt); expect(event.baseRelease).toBe('a'.repeat(64)); expect(event.patch[0].after).toBe(b64('blue\n')); expect(event.status).toBe('needs-review');
    expect(readFileSync(path.join(dir, 'work/index.js'), 'utf8')).toBe('original\n');
    expect(result.candidate).toBe(event.candidate);
  });
  it('requires consent and preserves failed attempts', async () => {
    const dir = workspace();
    await expect(ai.prompt(dir, { ...request, allowSourceSharing: false })).rejects.toThrow('permission');
    await expect(ai.prompt(dir, request, { fetch: async () => ({ ok: false, status: 429 }) })).rejects.toThrow('429');
    expect(worker.read(path.join(dir, 'state.json')).history[0].status).toBe('failed');
  });
  it('cannot edit fixed configuration or escape the candidate', () => {
    const dir = workspace();
    for (const file of ['../secret', '/tmp/secret', 'node_modules/a.js', 'package.json', '.env']) expect(() => ai.operate(path.join(dir, 'work'), 'write_file', { path: file, content: 'bad' })).toThrow();
  });
});

describe('editing recovery and migration provenance', () => {
  it('carries accepted prompts across successive major upgrades', () => {
    const first = workspace('a', 'a\nb\n'), second = workspace('b', 'a\nb\nc\n'), third = workspace('c', 'a\nb\nc\nd\n');
    writeFileSync(path.join(first, 'work/index.js'), 'A\nb\n');
    const state = worker.read(path.join(first, 'state.json')); state.history = [{ prompt: 'Capitalize first line', status: 'accepted', baseRelease: 'a'.repeat(64), patch: [] }]; worker.write(path.join(first, 'state.json'), state);
    const migration = worker.migrate(first, second);
    worker.restore(path.join(second, 'work'), worker.snapshot(path.join(second, 'candidates', migration.candidate)));
    worker.migrate(second, third);
    expect(worker.read(path.join(third, 'migration.json')).prompts.map((p: any) => p.prompt)).toContain('Capitalize first line');
  });
  it('recovers a working copy interrupted during acceptance', () => {
    const dir = workspace();
    const backup = path.join(dir, 'work-before-test');
    require('node:fs').renameSync(path.join(dir, 'work'), backup);
    worker.write(path.join(dir, 'accepting.json'), { backup, staged: path.join(dir, 'accept-test') });
    worker.prepare(manifest(), path.join(root, 'source-a'), path.join(root, 'toolkit'), path.join(root, 'support'));
    expect(readFileSync(path.join(dir, 'work/index.js'), 'utf8')).toBe('original\n');
  });
  it('rejects acceptance if source changed after compilation', () => {
    const dir = workspace();
    worker.write(path.join(dir, 'ready.json'), { release: 'a'.repeat(64), candidate: 'work', sourceHash: 'old' });
    expect(() => worker.accept(dir)).toThrow('Source changed');
  });
  it('invalidates stale candidates and retains intent after validation failure', async () => {
    const dir = workspace(); worker.write(path.join(dir, 'ready.json'), { old: true });
    await expect(ai.prompt(dir, { prompt: 'Make it blue', endpoint: 'https://example.test/chat', model: 'fixture', allowSourceSharing: true, apiKey: 'test-secret' }, {
      fetch: async (_url: string, options: any) => {
        expect(options.headers.Authorization).toBe('Bearer test-secret');
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Done' } }] }) };
      }, build: async () => { throw new Error('Compile failed'); },
    })).rejects.toThrow('Compile failed');
    expect(require('node:fs').existsSync(path.join(dir, 'ready.json'))).toBe(false);
    const state = readFileSync(path.join(dir, 'state.json'), 'utf8'); expect(state).not.toContain('test-secret'); expect(JSON.parse(state).history[0].prompt).toBe('Make it blue');
  });
  it('recovers an interrupted AI request before starting a new candidate', async () => {
    const dir = workspace(), file = path.join(dir, 'state.json'), state = worker.read(file);
    state.history.push({ prompt: 'Old request', status: 'running', pid: 2147483647 }); worker.write(file, state);
    await ai.prompt(dir, { prompt: 'New request', endpoint: 'https://example.test/chat', model: 'fixture', allowSourceSharing: true }, { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Done' } }] }) }), build: async () => {} });
    expect(worker.read(file).history[0].status).toBe('interrupted');
  });
});

describe('native opt-in configuration', () => {
  const plugin = require('../packages/config-plugin/app.plugin.cjs');
  const base = { name: 'Test', slug: 'test', platforms: ['macos'], macos: { bundleIdentifier: 'test.spark.example' } };
  it('adds native editing only to opted-in hosts', async () => {
    for (const enabled of [false, true]) {
      const config = plugin({ ...base, extra: { spark: { editable: enabled ? { repository: 'owner/app', files: ['index.ts'] } : false } } });
      const result = await config.mods.macos.appDelegate({ ...config, modResults: { contents: '' }, modRequest: { projectRoot: root, platform: 'macos', modName: 'appDelegate', introspect: false } });
      expect(result.modResults.contents.includes('@interface SparkEditableController')).toBe(enabled);
      expect(result.modResults.contents.includes('return SparkEditableBundleURL();')).toBe(enabled);
      expect(!!config.mods.macos.xcodeproj).toBe(enabled);
    }
  });
  it('rejects sandboxed editable app distribution', () => {
    expect(() => plugin({ ...base, macos: { ...base.macos, entitlements: { 'com.apple.security.app-sandbox': true } }, extra: { spark: { editable: { repository: 'owner/app', files: ['index.ts'] } } } })).toThrow('Sandbox');
  });
});
it('automatically returns compile errors to AI for a bounded repair attempt', async () => {
  const dir = workspace(); let builds = 0, calls = 0;
  await ai.prompt(dir, { prompt: 'Change greeting', endpoint: 'https://example.test/chat', model: 'fixture', allowSourceSharing: true }, {
    fetch: async (_url: string, options: any) => {
      if (++calls === 2) expect(JSON.parse(options.body).messages.at(-1).content).toContain('Missing greeting');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Done' } }] }) };
    }, build: async () => { if (++builds === 1) throw new Error('Missing greeting'); },
  });
  expect(builds).toBe(2); expect(worker.read(path.join(dir, 'state.json')).history[0].status).toBe('needs-review');
});

it('publishes only verified artifacts and never overwrites a conflicting release asset', async () => {
  const source = file('.spark/editable/source.tgz', 'source');
  const toolkit = file('.spark/editable/toolkit.tgz', 'toolkit');
  const sourceAsset = { url: githubAsset('owner/app', 'v1', 'source.tgz'), sha256: fileHash(source), size: 6 };
  const toolkitAsset = { url: githubAsset('owner/tools', 'v1', 'toolkit.tgz'), sha256: fileHash(toolkit), size: 7 };
  file('.spark/editable/manifest.json', JSON.stringify({ source: sourceAsset, toolkit: toolkitAsset }));
  file('.spark/editable/publish.json', JSON.stringify({ manifest: 'manifest.json', assets: [sourceAsset, toolkitAsset] }));
  const commands: string[][] = [];
  const execute = async (_root: string, args: string[]) => {
    commands.push(args);
    if (args[1] === 'repo') return JSON.stringify({ visibility: 'PUBLIC' });
    if (args[1] === 'api') return JSON.stringify({ assets: [] });
    return '';
  };
  await publishEditable(root, execute);
  expect(commands.filter(args => args[1] === 'release').length).toBe(3);
  await expect(publishEditable(root, async (_root, args) => args[1] === 'repo' ? JSON.stringify({ visibility: 'PUBLIC' }) : JSON.stringify({ assets: [{ name: 'source.tgz', digest: 'sha256:wrong' }] }))).rejects.toThrow('differs');
  await expect(publishEditable(root, async () => JSON.stringify({ visibility: 'PRIVATE' }))).rejects.toThrow('public');
  writeFileSync(source, 'tampered');
  await expect(publishEditable(root, execute)).rejects.toThrow('changed');
});

it('continues an unapplied candidate and saves all contributing prompts on acceptance', async () => {
  const dir = workspace();
  const request = { endpoint: 'https://example.test/chat', model: 'fixture', allowSourceSharing: true };
  let firstCall = 0;
  await ai.prompt(dir, { ...request, prompt: 'Make greeting blue' }, { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++firstCall === 1 ? { tool_calls: [{ id: '1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'index.js', content: 'blue\n' }) } }] } : { content: 'Blue greeting' } }] }) }), build: async () => {} });
  await ai.prompt(dir, { ...request, prompt: 'Now make it bigger' }, { fetch: async (_url: string, options: any) => {
    expect(JSON.parse(options.body).messages[1].content).toContain('Make greeting blue');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Done' } }] }) };
  }, build: async (_dir: string, candidate: string) => {
    expect(readFileSync(path.join(dir, 'candidates', candidate, 'index.js'), 'utf8')).toBe('blue\n');
    const build = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', bundle = path.join(dir, 'builds', build, 'main.jsbundle');
    mkdirSync(path.dirname(bundle), { recursive: true }); writeFileSync(bundle, 'bytecode');
    worker.write(path.join(dir, 'ready.json'), { release: 'a'.repeat(64), fingerprint: 'f', candidate, build, bundleHash: worker.hash(Buffer.from('bytecode')), sourceHash: worker.hash(JSON.stringify(worker.snapshot(path.join(dir, 'candidates', candidate)))) });
  } });
  worker.accept(dir);
  const history = worker.read(path.join(dir, 'state.json')).history;
  expect(history.map((item: any) => item.status)).toEqual(['accepted', 'accepted']);
  expect(history[1].ancestors).toEqual([history[0].id]);
});

describe('dependency publication boundaries', () => {
  it('honors files and nested npmignore rules for linked packages without running scripts', async () => {
    file('project/package.json', JSON.stringify({ dependencies: { local: '1' } }));
    file('local/package.json', JSON.stringify({ name: 'local', version: '1', files: ['dist'], scripts: { prepack: 'exit 1' } }));
    file('local/dist/index.js', 'module.exports = 42;');
    file('local/dist/.npmignore', 'private.txt\n');
    file('local/dist/private.txt', 'private');
    file('local/notes.txt', 'unpublished'); file('local/.env', 'SYNTHETIC_FIXTURE=1');
    mkdirSync(path.join(root, 'project/node_modules'), { recursive: true });
    symlinkSync(path.join(root, 'local'), path.join(root, 'project/node_modules/local'));
    const target = path.join(root, 'toolkit');
    await copyDependencies(path.join(root, 'project'), target);
    const published = worker.snapshot(path.join(target, 'packages/0'));
    expect(Object.keys(published).sort()).toEqual(['dist/index.js', 'package.json']);
    expect(readFileSync(path.join(target, 'node_modules/local/dist/index.js'), 'utf8')).toBe('module.exports = 42;');
  });
  it.each(['.env', 'config/.env.production', 'certs/signing.P12', 'certs/private.pem', 'certs/private.key', 'profile.mobileprovision'])('rejects selected credential file %s', async name => {
    file('project/package.json', JSON.stringify({ dependencies: { local: '1' } }));
    file('project/node_modules/local/package.json', JSON.stringify({ name: 'local', version: '1' }));
    file('project/node_modules/local/' + name, 'SYNTHETIC_FIXTURE');
    await expect(copyDependencies(path.join(root, 'project'), path.join(root, 'toolkit'))).rejects.toThrow('Do not publish credentials');
  });
  it('honors gitignore fallback and excludes links to private files', async () => {
    file('project/package.json', JSON.stringify({ dependencies: { local: '1' } }));
    file('project/node_modules/local/package.json', JSON.stringify({ name: 'local', version: '1' }));
    file('project/node_modules/local/.gitignore', 'private.txt\n');
    file('project/node_modules/local/private.txt', 'private');
    file('outside.txt', 'private');
    symlinkSync(path.join(root, 'outside.txt'), path.join(root, 'project/node_modules/local/linked.txt'));
    await copyDependencies(path.join(root, 'project'), path.join(root, 'toolkit'));
    expect(Object.keys(worker.snapshot(path.join(root, 'toolkit/packages/0')))).toEqual(['package.json']);
  });
});

describe('complete candidate review', () => {
  const request = { endpoint: 'https://example.test/chat', model: 'fixture', allowSourceSharing: true };
  async function edit(dir: string, prompt: string, name?: string, content?: string, fail = false) {
    let calls = 0;
    return ai.prompt(dir, { ...request, prompt }, {
      fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: ++calls === 1 && name ? { tool_calls: [{ id: '1', function: { name: 'write_file', arguments: JSON.stringify({ path: name, content }) } }] } : { content: 'Done' } }] }) }),
      build: async () => { if (fail) throw new Error('Compile failed'); },
    });
  }
  it('shows earlier unapplied changes and all contributing prompts even after a no-op follow-up', async () => {
    const dir = workspace();
    await edit(dir, 'Change first file', 'index.js', 'changed\n');
    await edit(dir, 'Add second file', 'second.js', 'second\n');
    await edit(dir, 'Keep those edits');
    const review = readFileSync(path.join(dir, 'review.txt'), 'utf8');
    for (const value of ['index.js', 'second.js', '-original', '+changed', 'Change first file', 'Add second file', 'Keep those edits']) expect(review).toContain(value);
    const history = worker.read(path.join(dir, 'state.json')).history;
    expect(history[1].patch.map((item: any) => item.path)).toEqual(['second.js']);
    expect(history[2].patch).toEqual([]);
  });
  it('compares against accepted source and retains the full review on build failure', async () => {
    const dir = workspace(); writeFileSync(path.join(dir, 'work/index.js'), 'accepted\n');
    await edit(dir, 'Change accepted greeting', 'index.js', 'candidate\n');
    await expect(edit(dir, 'Add a broken file', 'broken.js', 'broken\n', true)).rejects.toThrow('Compile failed');
    const review = readFileSync(path.join(dir, 'review.txt'), 'utf8');
    expect(review).toContain('-accepted'); expect(review).not.toContain('-original');
    expect(review).toContain('+candidate'); expect(review).toContain('broken.js'); expect(review).toContain('Status: failed');
  });
  it('includes merged migration changes and inherited intent when AI makes no additional edits', async () => {
    const old = workspace('a', 'a\nb\n'), next = workspace('b', 'a\nb\nc\n');
    writeFileSync(path.join(old, 'work/index.js'), 'A\nb\n');
    const state = worker.read(path.join(old, 'state.json'));
    state.history.push({ prompt: 'Capitalize the first line', status: 'accepted', patch: [] }); worker.write(path.join(old, 'state.json'), state);
    worker.migrate(old, next);
    expect(readFileSync(path.join(next, 'review.txt'), 'utf8')).toContain('Capitalize the first line');
    await edit(next, 'Preserve my edits');
    const review = readFileSync(path.join(next, 'review.txt'), 'utf8');
    for (const value of ['Capitalize the first line', 'Preserve my edits', 'index.js', '-a', '+A']) expect(review).toContain(value);
  });
});
