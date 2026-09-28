import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileHash, type EditableManifest } from '../../packages/cli/src/editable-artifacts.ts';
const require = createRequire(import.meta.url);
const { validateManifest } = require('../../packages/cli/src/editable-worker.cjs');
const exec = promisify(execFile);

/** Seed the production cache from the exact archives pinned by a locally built app. */
export async function installEditableLocally(manifest: EditableManifest, artifacts: string, cache: string) {
  validateManifest(manifest);
  const assets = [['source', manifest.source], ['toolkit', manifest.toolkit]] as const;
  // Verify both before changing the cache. URLs and hashes in the signed app remain untouched.
  for (const [, asset] of assets) {
    const archive = path.join(artifacts, path.basename(new URL(asset.url).pathname));
    if (statSync(archive).size !== asset.size || fileHash(archive) !== asset.sha256) throw new Error(`Local editable archive does not match the app: ${archive}`);
  }
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const installed: Record<string, string> = {};
  for (const [kind, asset] of assets) {
    const target = path.join(cache, asset.sha256);
    const complete = () => {
      try { return JSON.parse(readFileSync(path.join(target, 'complete.json'), 'utf8')).sha256 === asset.sha256 && statSync(path.join(target, kind)).isDirectory(); } catch { return false; }
    };
    installed[kind] = path.join(target, kind);
    if (complete()) continue;
    if (existsSync(target)) throw new Error(`Incomplete cache entry; inspect it before retrying: ${target}`);
    const stage = mkdtempSync(path.join(cache, `${asset.sha256}.local-`));
    try {
      const archive = path.join(artifacts, path.basename(new URL(asset.url).pathname));
      const { stdout } = await exec('/usr/bin/tar', ['-tzf', archive], { maxBuffer: 32 * 1024 ** 2 });
      if (stdout.trim().split('\n').some(name => !(name === kind || name.startsWith(`${kind}/`)) || name.split('/').includes('..'))) throw new Error('Unexpected path in local editable archive');
      await exec('/usr/bin/tar', ['-xzf', archive, '-C', stage]);
      if (!statSync(path.join(stage, kind)).isDirectory()) throw new Error('Incomplete editable archive');
      writeFileSync(path.join(stage, 'complete.json'), JSON.stringify({ sha256: asset.sha256 }), { mode: 0o600 });
      try { renameSync(stage, target); } catch (error) { if (!complete()) throw error; }
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  return installed;
}
