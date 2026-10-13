import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileHash } from '../packages/cli/src/editable-artifacts.ts';
import { installEditableLocally } from '../scripts/helpers/editable-local.ts';
import { fixtureReply } from '../scripts/helpers/editable-fixture-provider.ts';
let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'spark-editable-local-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function manifest() {
  const assets = Object.fromEntries(['source','toolkit'].map(kind => {
    mkdirSync(path.join(root, kind)); writeFileSync(path.join(root, kind, 'fixture.txt'), kind);
    const archive = path.join(root, `${kind}.tgz`);
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', root, kind]);
    return [kind, { url: `https://github.com/local/test/releases/download/v1/${kind}.tgz`, sha256: fileHash(archive), size: readFileSync(archive).length }];
  }));
  return { schema: 1, project: 'test', version: '1', entry: 'fixture.txt', release: 'a'.repeat(64), runtime: { platform: 'macos', mode: 'release' }, ...assets } as any;
}
describe.skipIf(process.platform !== 'darwin')('local editing cache', () => {
  it('installs pinned archives once without changing the app manifest', async () => {
    const input = manifest(), before = JSON.stringify(input), cache = path.join(root, 'cache');
    const installed = await installEditableLocally(input, root, cache);
    expect(readFileSync(path.join(installed.source!, 'fixture.txt'), 'utf8')).toBe('source');
    expect(await installEditableLocally(input, root, cache)).toEqual(installed);
    expect(readdirSync(cache).sort()).toEqual([input.source.sha256, input.toolkit.sha256].sort());
    expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects tampered archives before populating any cache entries', async () => {
    const input = manifest(), cache = path.join(root, 'cache'); writeFileSync(path.join(root, 'toolkit.tgz'), 'tampered');
    await expect(installEditableLocally(input, root, cache)).rejects.toThrow('does not match');
    expect(existsSync(cache)).toBe(false);
  });
  it('preserves an incomplete existing cache entry for inspection', async () => {
    const input = manifest(), cache = path.join(root, 'cache'); mkdirSync(path.join(cache, input.source.sha256), { recursive: true });
    writeFileSync(path.join(cache, input.source.sha256, 'keep'), 'keep');
    await expect(installEditableLocally(input, root, cache)).rejects.toThrow('Incomplete cache');
    expect(readFileSync(path.join(cache, input.source.sha256, 'keep'), 'utf8')).toBe('keep');
  });
});
it('fake prompting reads then writes source and preserves unrelated edits', () => {
  const messages: any[] = [{ role: 'user', content: JSON.stringify({ prompt: 'Make the greeting larger' }) }];
  expect(fixtureReply(messages).tool_calls![0].function.name).toBe('read_file');
  messages.push({ role: 'tool', content: JSON.stringify("{ color: '#2563eb', fontSize: 34 } // keep") });
  const call = fixtureReply(messages).tool_calls![0];
  expect(JSON.parse(call.function.arguments).content).toBe("{ color: '#2563eb', fontSize: 48 } // keep");
  messages.push({ role: 'tool', content: JSON.stringify('Written') });
  expect(fixtureReply(messages).tool_calls).toBeUndefined();
});
it('fake prompting leaves unsupported requests unchanged', () => {
  expect(fixtureReply([{ role: 'user', content: JSON.stringify({ prompt: 'Invent a game' }) }]).tool_calls).toBeUndefined();
});
