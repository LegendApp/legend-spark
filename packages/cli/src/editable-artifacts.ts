import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './commands.ts';
import { entryFile, readAppConfig, readJson, stateFile, VERSION, writeJson, type Runtime } from './project.ts';
const require = createRequire(import.meta.url);
const { validateEditable } = require('@legendapp/spark-desktop-config/editable.cjs');
export type EditableAsset = { url: string; sha256: string; size: number };
export type EditableManifest = {
  schema: 1; project: string; version: string; release: string; runtime: Runtime;
  entry: string; source: EditableAsset; toolkit: EditableAsset;
};
export function fileHash(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function githubAsset(repository: string, tag: string, file: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]+$/.test(tag) || !/^[\w.-]+$/.test(file)) throw new Error('Invalid GitHub release asset path');
  return `https://github.com/${repository}/releases/download/${tag}/${file}`;
}
export function copySource(root: string, destination: string, files: string[]) {
  function copy(relative: string) {
    const file = path.join(root, relative), stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Editable source must be self-contained, not a symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(file).sort()) {
        if (name.startsWith('.') || ['node_modules', 'Pods', 'build', 'dist', 'macos', 'ios', 'android', 'windows'].includes(name)) continue;
        copy(path.join(relative, name));
      }
    } else if (stat.isFile()) {
      if (/\.(?:p12|p8|pem|key|mobileprovision)$/i.test(relative)) throw new Error(`Do not publish credentials in editable source: ${relative}`);
      mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
      cpSync(file, path.join(destination, relative));
    } else throw new Error(`Unsupported source file: ${relative}`);
  }
  for (const file of files) copy(file);
}
/** Preserve each resolved dependency edge (including duplicate versions), without installing on users' machines. */
export function copyDependencies(root: string, destination: string, extra: Record<string, string> = {}) {
  const visited = new Map<string, string>();
  const ignored = new Set(['node_modules', '.git', '.cache', 'Pods', '.spark']);
  function resolve(from: string, name: string) {
    const req = createRequire(path.join(from, 'package.json'));
    try { return path.dirname(req.resolve(`${name}/package.json`)); }
    catch {
      let file: string;
      try { file = path.dirname(req.resolve(name)); } catch { return undefined; }
      while (file !== path.dirname(file)) {
        if (existsSync(path.join(file, 'package.json')) && readJson(path.join(file, 'package.json')).name === name) return file;
        file = path.dirname(file);
      }
    }
  }
  function link(from: string, name: string, source: string) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) throw new Error(`Invalid package name ${name}`);
    const target = visit(source);
    const location = path.join(from, 'node_modules', name);
    mkdirSync(path.dirname(location), { recursive: true });
    if (!existsSync(location)) symlinkSync(path.relative(path.dirname(location), target), location);
  }
  function visit(source: string): string {
    source = realpathSync(source);
    if (visited.has(source)) return visited.get(source)!;
    const target = path.join(destination, 'packages', String(visited.size));
    visited.set(source, target);
    cpSync(source, target, { recursive: true, dereference: true, filter: file => !path.relative(source, file).split(path.sep).some(part => ignored.has(part)) });
    const pkg = readJson(path.join(source, 'package.json'));
    const anchor = path.join(source, pkg.spark?.bundledModuleRoot ?? '.');
    const targetAnchor = path.join(target, pkg.spark?.bundledModuleRoot ?? '.');
    const bundled = pkg.spark?.bundledModules ?? pkg.bundledDependencies ?? pkg.bundleDependencies ?? [];
    const edges = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), ...(Array.isArray(bundled) ? bundled : [])]);
    for (const name of [...edges].sort()) {
      const dependency = resolve(anchor, name);
      if (dependency) link(targetAnchor, name, dependency);
      else if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name]) throw new Error(`Missing dependency ${pkg.name} -> ${name}`);
    }
    return target;
  }
  const pkg = readJson(path.join(root, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...extra }).sort()) {
    const dependency = extra[name] ?? resolve(root, name);
    if (!dependency) throw new Error(`Missing editable dependency ${name}`);
    link(destination, name, dependency);
  }
  return visited.size;
}
export async function prepareEditableArtifacts(root: string, runtime: Runtime, app: string) {
  const config = readAppConfig(root).expo;
  const options = validateEditable(config.extra?.spark?.editable);
  if (!options) return;
  if (runtime.platform !== 'macos' || runtime.mode !== 'release') throw new Error('Editable apps require a macOS release build');
  if (config.macos?.entitlements?.['com.apple.security.app-sandbox']) throw new Error('Editable apps require direct distribution without App Sandbox');
  const output = stateFile(root, 'editable');
  mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(path.join(output, '.stage-'));
  try {
    const source = path.join(stage, 'source'), toolkit = path.join(stage, 'toolkit');
    mkdirSync(source); mkdirSync(toolkit);
    copySource(root, source, options.files);
    // App configuration and build transforms must be included explicitly and reviewable.
    for (const file of ['package.json', 'metro.config.js', 'babel.config.js']) if (!existsSync(path.join(source, file))) throw new Error(`Include ${file} in editable.files`);
    if (!existsSync(path.join(source, 'desktop.config.json')) && !existsSync(path.join(source, 'app.json'))) throw new Error('Include desktop.config.json or app.json in editable.files');
    const entry = entryFile(root);
    if (entry.startsWith('..') || path.isAbsolute(entry) || !existsSync(path.join(source, entry))) throw new Error('Editable entry must be inside the published source snapshot');
    copyDependencies(root, toolkit, { diff: path.dirname(require.resolve('diff/package.json')) });
    for (const file of ['editable-worker.cjs', 'editable-ai.cjs', 'js-runtime.cjs', 'runtime-bootstrap.sh', 'runtime-downloads.tsv']) cpSync(path.join(import.meta.dirname, file), path.join(toolkit, file));
    const appRequire = createRequire(path.join(root, 'package.json'));
    const rn = path.dirname(appRequire.resolve('react-native/package.json'));
    const hermesc = [path.join(root, 'macos/Pods/hermes-engine/destroot/bin/hermesc'), path.join(rn, 'sdks/hermesc/osx-bin/hermesc')].find(existsSync);
    if (!hermesc) throw new Error('Matching macOS Hermes compiler is missing');
    cpSync(hermesc, path.join(toolkit, 'hermesc'));
    writeJson(path.join(toolkit, 'toolkit.json'), { schema: 1, framework: VERSION, arch: runtime.arch, compiler: fileHash(hermesc) });
    async function archive(name: string, repository: string, tag: string): Promise<EditableAsset> {
      const pending = path.join(stage, `${name}.tgz`);
      await run(root, ['/usr/bin/tar', '-czf', pending, '-C', stage, name], { env: { COPYFILE_DISABLE: '1' }, capture: true });
      const size = statSync(pending).size;
      if (size >= 2 * 1024 ** 3) throw new Error(`Editable ${name} exceeds GitHub's per-asset limit`);
      const sha256 = fileHash(pending), filename = `spark-editable-${name}-macos-${runtime.arch}-${sha256}.tgz`;
      const target = path.join(output, filename);
      if (!existsSync(target)) renameSync(pending, target);
      return { url: githubAsset(repository, tag, filename), sha256, size };
    }
    const sourceAsset = await archive('source', options.repository, options.tag ?? `v${config.version}`);
    const toolkitAsset = await archive('toolkit', options.toolkitRepository ?? 'LegendApp/legend-spark', options.toolkitTag ?? `editable-v${VERSION}`);
    const manifest: EditableManifest = { schema: 1, project: config.macos.bundleIdentifier, version: config.version,
      release: jsonHash({ runtime, source: sourceAsset.sha256, toolkit: toolkitAsset.sha256 }), runtime, entry, source: sourceAsset, toolkit: toolkitAsset };
    const filename = `spark-editable-${manifest.release}.json`;
    writeJson(path.join(output, filename), manifest);
    writeJson(path.join(app, 'Contents/Resources/spark-editable.json'), manifest);
    writeJson(path.join(output, 'publish.json'), { manifest: filename, assets: [sourceAsset, toolkitAsset] });
    return manifest;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
/** Explicit command only. Never replaces an existing asset with different bytes. */
export async function publishEditable(root: string) {
  const output = stateFile(root, 'editable'), record = readJson(path.join(output, 'publish.json'));
  const manifest = readJson(path.join(output, record.manifest));
  const assets = [...record.assets, { url: manifest.source.url.replace(/[^/]+$/, record.manifest), sha256: fileHash(path.join(output, record.manifest)) }];
  for (const asset of assets) {
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/download\/([\w.-]+)\/([\w.-]+)$/.exec(asset.url);
    if (!match) throw new Error('Invalid publication URL');
    const [, repository, tag, name] = match;
    const file = path.join(output, name!);
    if (fileHash(file) !== asset.sha256) throw new Error(`Artifact changed: ${name}`);
    const info = JSON.parse(await run(root, ['gh', 'repo', 'view', repository!, '--json', 'visibility'], { capture: true }));
    if (info.visibility !== 'PUBLIC') throw new Error('Editable downloads require a public release repository');
    const release = JSON.parse(await run(root, ['gh', 'api', `repos/${repository}/releases/tags/${tag}`], { capture: true }));
    const existing = release.assets.find((item: any) => item.name === name);
    if (existing) {
      if (existing.digest !== `sha256:${asset.sha256}`) throw new Error(`Release asset differs: ${name}`);
    } else await run(root, ['gh', 'release', 'upload', tag!, '--repo', repository!, file]);
  }
}
