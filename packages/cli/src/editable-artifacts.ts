import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, lutimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { run } from './commands.ts';
import { entryFile, readAppConfig, readJson, stateFile, VERSION, writeJson, type Runtime } from './project.ts';
const require = createRequire(import.meta.url);
const { validateEditable } = require('@legendapp/spark-desktop-config/editable.cjs');
const { isBuildConfig, collectTrustedFiles } = require('./editable-policy.cjs');
export type EditableAsset = { url: string; sha256: string; size: number };
export type EditableManifest = {
  schema: 1; project: string; version: string; release: string; runtime: Runtime;
  repository: string; repositoryDirectory: string; projectRoot: string;
  entry: string; source: EditableAsset; toolkit: EditableAsset;
  editing?: { ui: 'default' | 'custom'; githubClientId?: string; trustedFiles: string[]; provider?: { kind: 'cli'; tool: 'codex' | 'claude'; model?: string } | { kind: 'local' | 'remote'; endpoint: string; model: string } };
};
export function fileHash(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function githubAsset(repository: string, tag: string, file: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]+$/.test(tag) || !/^[\w.-]+$/.test(file)) throw new Error('Invalid GitHub release asset path');
  return `https://github.com/${repository}/releases/download/${tag}/${file}`;
}
export function copySource(root: string, destination: string, files: string[]) {
  function copy(relative: string) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Editable source paths must stay inside their source root');
    let current = root;
    for (const part of relative.split(/[\\/]/)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Editable source must be self-contained, not a symlink: ${relative}`);
    }
    const file = path.join(root, relative), stat = lstatSync(file);
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
/** Preserve repository paths while making generated entry/config absolute paths portable. */
export function prepareSource(root: string, destination: string, files: string[], sourceRoot = '.') {
  const sourcePath = path.resolve(root, sourceRoot), source = realpathSync(sourcePath);
  root = realpathSync(root);
  const projectRoot = path.relative(source, root);
  if (projectRoot.startsWith('..') || path.isAbsolute(projectRoot)) throw new Error('editable.sourceRoot must contain the app project');
  copySource(source, destination, files);
  const entry = entryFile(root);
  if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('Editable entry must be inside the app project');
  if (sourceRoot !== '.') {
    // Generated projects sit outside the source allowlist, but these publisher-owned
    // build files are required to reproduce the shell and will be frozen at runtime.
    const buildFiles = readdirSync(root).filter(file => /^(?:package\.json|desktop\.config\.json|app\.json|.*\.config\.[cm]?[jt]s|\.babelrc(?:\.[cm]?js|\.json)?)$/.test(file));
    copySource(root, path.join(destination, projectRoot), [...buildFiles, entry]);
  }
  const project = path.join(destination, projectRoot);
  if (!existsSync(path.join(project, 'package.json'))) throw new Error('Include package.json in editable.files');
  if (!['metro.config.js', 'metro.config.cjs', 'metro.config.mjs'].some(file => existsSync(path.join(project, file)))) throw new Error('Include metro.config.js, metro.config.cjs or metro.config.mjs in editable.files');
  if (!existsSync(path.join(project, 'desktop.config.json')) && !existsSync(path.join(project, 'app.json'))) throw new Error('Include desktop.config.json or app.json in editable.files');
  if (!existsSync(path.join(project, entry))) throw new Error('Editable entry must be inside the published source snapshot');
  function relocate(folder: string) {
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name);
      if (lstatSync(file).isDirectory()) { relocate(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const content = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const replacements: { start: number; end: number; text: string }[] = [];
      function visit(node: ts.Node) {
        if (ts.isTemplateExpression(node) && [source, sourcePath].some(base => node.getText(ast).includes(base))) throw new Error(`Editable source must use literal paths: ${path.relative(destination, file)}`);
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const value = node.text, parent = node.parent;
          const imported = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node || ts.isCallExpression(parent) && parent.arguments[0] === node && ['require', 'require.resolve', 'import'].includes(parent.expression.getText(ast));
          const base = [source, sourcePath].find(base => value === base || value.startsWith(base + path.sep));
          if (path.isAbsolute(value) && base) {
            if (!imported && !isBuildConfig(path.relative(destination, file).split(path.sep).join('/'))) throw new Error(`Editable app source must use relative imports rather than absolute runtime paths: ${path.relative(destination, file)}`);
            const target = path.join(destination, path.relative(base, value));
            if (imported && !['', '.js', '.jsx', '.ts', '.tsx', '.json', '.mjs', '.cjs', '.macos.js', '.macos.tsx', '.native.js', '.native.tsx'].some(extension => existsSync(target + extension))) throw new Error(`Missing import in editable.files: ${path.relative(base, value)}`);
            const relative = path.relative(path.dirname(file), target).split(path.sep).join('/') || '.';
            const literal = JSON.stringify(relative.startsWith('.') ? relative : './' + relative);
            const expression = file.endsWith('.mjs') || file.endsWith('.mts') ? `decodeURIComponent(new URL(${literal}, import.meta.url).pathname).replace(/\\/$/, "")` : `require("node:path").resolve(__dirname, ${literal})`;
            replacements.push({ start: node.getStart(ast), end: node.end, text: imported ? literal : expression });
          } else if (path.isAbsolute(value) && (imported || /^\/(?:Users|home|private|tmp|var)\//.test(value))) throw new Error(`Editable source contains a path outside sourceRoot: ${path.relative(destination, file)}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      let relocated = content;
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) relocated = relocated.slice(0, replacement.start) + replacement.text + relocated.slice(replacement.end);
      if (relocated !== content) writeFileSync(file, relocated);
    }
  }
  relocate(destination);
  return { sourceRoot: source, projectRoot: projectRoot.split(path.sep).join('/') || '.', entry };
}
/** Preserve each resolved dependency edge (including duplicate versions), without installing on users' machines. */
export async function copyDependencies(root: string, destination: string, extra: Record<string, string> = {}) {
  // Use the publication rules from Spark's pinned npm, without running package scripts.
  const npmRequire = createRequire(require.resolve('npm/package.json'));
  const packlist = npmRequire('npm-packlist');
  const { Node } = npmRequire('@npmcli/arborist');
  const visited = new Map<string, string>();
  const ignored = new Set(['node_modules', '.git', '.cache', 'Pods', '.spark']);
  function resolve(from: string, name: string) {
    const req = createRequire(path.join(from, 'package.json'));
    try { return path.dirname(req.resolve(`${name}/package.json`)); }
    catch {
      for (const modules of req.resolve.paths(name) ?? []) {
        const candidate = path.join(modules, name);
        if (existsSync(path.join(candidate, 'package.json')) && readJson(path.join(candidate, 'package.json')).name === name) return candidate;
      }
      let file: string;
      try { file = path.dirname(req.resolve(name)); } catch { return undefined; }
      while (file !== path.dirname(file)) {
        if (existsSync(path.join(file, 'package.json')) && readJson(path.join(file, 'package.json')).name === name) return file;
        file = path.dirname(file);
      }
    }
  }
  async function link(from: string, name: string, source: string) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) throw new Error(`Invalid package name ${name}`);
    const target = await visit(source);
    const location = path.join(from, 'node_modules', name);
    mkdirSync(path.dirname(location), { recursive: true });
    if (!existsSync(location)) symlinkSync(path.relative(path.dirname(location), target), location);
  }
  async function visit(source: string): Promise<string> {
    source = realpathSync(source);
    if (visited.has(source)) return visited.get(source)!;
    const target = path.join(destination, 'packages', String(visited.size));
    visited.set(source, target);
    const pkg = readJson(path.join(source, 'package.json'));
    // Resolve dependency edges ourselves so duplicate versions and bundled modules stay intact.
    const files: string[] = await packlist(new Node({ path: source, pkg }));
    for (const relative of files.sort()) {
      if (relative.split(path.sep).some(part => ignored.has(part))) continue;
      if (/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|.*\.(?:p12|p8|pem|key|mobileprovision))$/i.test(relative)) throw new Error(`Do not publish credentials in editable dependency ${pkg.name}: ${relative}`);
      const file = path.join(source, relative);
      if (!lstatSync(file).isFile() || !realpathSync(file).startsWith(source + path.sep)) throw new Error(`Editable dependency file must be contained in ${pkg.name}: ${relative}`);
      mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
      cpSync(file, path.join(target, relative), { preserveTimestamps: true });
    }
    // Packages without an exports map still resolve their own package name through node_modules.
    await link(target, pkg.name, source);
    const anchor = path.join(source, pkg.spark?.bundledModuleRoot ?? '.');
    const targetAnchor = path.join(target, pkg.spark?.bundledModuleRoot ?? '.');
    const bundled = pkg.spark?.bundledModules ?? pkg.bundledDependencies ?? pkg.bundleDependencies ?? [];
    const edges = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), ...(Array.isArray(bundled) ? bundled : [])]);
    for (const name of [...edges].sort()) {
      const dependency = resolve(anchor, name);
      if (dependency) await link(targetAnchor, name, dependency);
      else if (pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name]) throw new Error(`Missing dependency ${pkg.name} -> ${name}`);
    }
    return target;
  }
  const pkg = readJson(path.join(root, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...extra }).sort()) {
    const dependency = extra[name] ?? resolve(root, name);
    if (!dependency) throw new Error(`Missing editable dependency ${name}`);
    await link(destination, name, dependency);
  }
  // Metro/Expo resolve plugins from the app root, including hoisted transitive dependencies.
  // Reproduce only aliases that resolve to this exact package in the publisher's installation.
  for (const source of [...visited.keys()]) {
    const name = readJson(path.join(source, 'package.json')).name;
    const resolved = resolve(root, name);
    if (resolved && realpathSync(resolved) === source) await link(destination, name, source);
  }
  return visited.size;
}
export async function prepareEditableArtifacts(root: string, runtime: Runtime, app: string) {
  const config = readAppConfig(root).expo;
  const options = validateEditable(config.extra?.spark?.editable);
  if (!options) return;
  if (runtime.platform !== 'macos' || runtime.mode !== 'release') throw new Error('Editable apps require a macOS release build');
  if (config.macos?.entitlements?.['com.apple.security.app-sandbox']) throw new Error('Editable apps require direct distribution without App Sandbox');
  if (!config.macos?.bundleIdentifier || !config.version) throw new Error('Editable apps require a bundle identifier and version');
  const output = stateFile(root, 'editable');
  mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(path.join(output, '.stage-'));
  try {
    const source = path.join(stage, 'source'), toolkit = path.join(stage, 'toolkit');
    mkdirSync(source); mkdirSync(toolkit);
    const layout = prepareSource(root, source, options.files, options.sourceRoot);
    const repository = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
    const repositoryDirectory = repository.status === 0 ? path.relative(realpathSync(repository.stdout.trim()), layout.sourceRoot).split(path.sep).join('/') : '';
    if (repositoryDirectory.startsWith('..') || path.isAbsolute(repositoryDirectory)) throw new Error('editable.sourceRoot must stay within the Git repository');
    const trustedFiles = collectTrustedFiles(source);
    const appRequire = createRequire(path.join(root, 'package.json'));
    await copyDependencies(root, toolkit, { diff: path.dirname(require.resolve('diff/package.json')), 'react-native-macos': path.dirname(appRequire.resolve('react-native-macos/package.json')) });
    for (const file of ['editable-worker.cjs', 'editable-ai.cjs', 'editable-cli.cjs', 'editable-policy.cjs', 'editable-github.cjs', 'js-runtime.cjs', 'runtime-bootstrap.sh', 'runtime-downloads.tsv']) cpSync(path.join(import.meta.dirname, file), path.join(toolkit, file));
    cpSync(createRequire(appRequire.resolve('@legendapp/spark/ai')).resolve('@legendapp/spark-ai/src/invocation-command.cjs'), path.join(toolkit, 'ai-invocation.cjs'));
    cpSync(require.resolve('@legendapp/spark-desktop-config/editable-provider.cjs'), path.join(toolkit, 'editable-provider.cjs'));
    const rn = path.dirname(appRequire.resolve('react-native/package.json'));
    const hermesc = [path.join(root, 'macos/Pods/hermes-engine/destroot/bin/hermesc'), path.join(rn, 'sdks/hermesc/osx-bin/hermesc')].find(existsSync);
    if (!hermesc) throw new Error('Matching macOS Hermes compiler is missing');
    cpSync(hermesc, path.join(toolkit, 'hermesc'));
    writeJson(path.join(toolkit, 'toolkit.json'), { schema: 1, framework: VERSION, arch: runtime.arch, compiler: fileHash(hermesc) });
    async function archive(name: string, repository: string, tag: string): Promise<EditableAsset> {
      function normalize(file: string) {
        const info = lstatSync(file);
        if (info.isSymbolicLink()) { lutimesSync(file, 0, 0); return; }
        if (info.isDirectory()) for (const child of readdirSync(file).sort()) normalize(path.join(file, child));
        utimesSync(file, 0, 0);
      }
      normalize(path.join(stage, name));
      const pending = path.join(stage, `${name}.tgz`);
      await run(root, ['/usr/bin/tar', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'wheel', '-czf', pending, '-C', stage, name], { env: { COPYFILE_DISABLE: '1' }, capture: true });
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
      release: jsonHash({ runtime, source: sourceAsset.sha256, toolkit: toolkitAsset.sha256 }), runtime, entry: layout.entry, projectRoot: layout.projectRoot,
      repository: options.repository, repositoryDirectory, source: sourceAsset, toolkit: toolkitAsset,
      editing: { ui: options.ui ?? 'default', trustedFiles, ...(options.githubClientId ? { githubClientId: options.githubClientId } : {}), ...(options.provider ? { provider: require('@legendapp/spark-desktop-config/editable-provider.cjs').validateProvider(options.provider) } : {}) } };
    const filename = `spark-editable-${manifest.release}.json`;
    writeJson(path.join(output, filename), manifest);
    writeJson(path.join(app, 'Contents/Resources/spark-editable.json'), manifest);
    writeJson(path.join(output, 'publish.json'), { manifest: filename, assets: [sourceAsset, toolkitAsset] });
    return manifest;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
/** Explicit command only. Never replaces an existing asset with different bytes. */
export async function publishEditable(root: string, execute = run) {
  const output = stateFile(root, 'editable'), record = readJson(path.join(output, 'publish.json'));
  const manifest = readJson(path.join(output, record.manifest));
  const assets = [...record.assets, { url: manifest.source.url.replace(/[^/]+$/, record.manifest), sha256: fileHash(path.join(output, record.manifest)) }];
  for (const asset of assets) {
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/download\/([\w.-]+)\/([\w.-]+)$/.exec(asset.url);
    if (!match) throw new Error('Invalid publication URL');
    const [, repository, tag, name] = match;
    const file = path.join(output, name!);
    if (fileHash(file) !== asset.sha256) throw new Error(`Artifact changed: ${name}`);
    const info = JSON.parse(await execute(root, ['gh', 'repo', 'view', repository!, '--json', 'visibility'], { capture: true }));
    if (info.visibility !== 'PUBLIC') throw new Error('Editable downloads require a public release repository');
    const release = JSON.parse(await execute(root, ['gh', 'api', `repos/${repository}/releases/tags/${tag}`], { capture: true }));
    const existing = release.assets.find((item: any) => item.name === name);
    if (existing) {
      if (existing.digest !== `sha256:${asset.sha256}`) throw new Error(`Release asset differs: ${name}`);
    } else await execute(root, ['gh', 'release', 'upload', tag!, '--repo', repository!, file]);
  }
}
