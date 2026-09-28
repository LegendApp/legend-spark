import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { copySource, copyDependencies, githubAsset } from '../packages/cli/src/editable-artifacts.ts';
const require = createRequire(import.meta.url);
const { validateEditable } = require('../packages/config-plugin/editable.cjs');
const worker = require('../packages/cli/src/editable-worker.cjs');
const ai = require('../packages/cli/src/editable-ai.cjs');
const b64 = (text: string) => Buffer.from(text).toString('base64');
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'spark-editable-test-')); });
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
  });
  it('preserves nested conflicting dependency versions after relocation', () => {
    file('project/package.json', JSON.stringify({ dependencies: { a: '1', x: '1' } }));
    file('project/node_modules/a/package.json', JSON.stringify({ name: 'a', version: '1', dependencies: { x: '2' } }));
    file('project/node_modules/a/index.js', "module.exports = require('x');");
    file('project/node_modules/a/node_modules/x/package.json', JSON.stringify({ name: 'x', version: '2' }));
    file('project/node_modules/a/node_modules/x/index.js', "module.exports = 2;");
    file('project/node_modules/x/package.json', JSON.stringify({ name: 'x', version: '1' }));
    file('project/node_modules/x/index.js', "module.exports = 1;");
    const target = path.join(root, 'relocated');
    copyDependencies(path.join(root, 'project'), target);
    rmSync(path.join(root, 'project'), { recursive: true });
    const req = createRequire(path.join(target, 'package.json'));
    expect(req('a')).toBe(2); expect(req('x')).toBe(1);
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
