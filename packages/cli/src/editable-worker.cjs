// Downloadable editing worker. No toolchain code is linked into the application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function safe(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || p === 'node_modules' || p.startsWith('.spark'))) throw new Error('Invalid workspace path');
  const file = path.join(root, relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Workspace symlinks are not editable');
  }
  return file;
}
function snapshot(root) {
  const result = {};
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.spark', '.expo', '.threaded-runtime', '.git'].includes(entry.name)) continue;
      const name = path.posix.join(relative, entry.name), file = path.join(root, name);
      if (entry.isSymbolicLink()) throw new Error(`Source symlink: ${name}`);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) result[name] = fs.readFileSync(file).toString('base64');
    }
  }
  visit(''); return result;
}
function restore(root, files) {
  fs.mkdirSync(root, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    const file = safe(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(bytes, 'base64'));
  }
}
function patch(base, modified) {
  return Object.keys({ ...base, ...modified }).sort().filter(name => base[name] !== modified[name]).map(name => ({ path: name, before: base[name] ?? null, after: modified[name] ?? null }));
}
function text(bytes) {
  const value = Buffer.from(bytes, 'base64');
  if (value.includes(0)) return undefined;
  const decoded = value.toString('utf8');
  return Buffer.from(decoded).equals(value) ? decoded : undefined;
}
function reviewPatch(changes) {
  const { createTwoFilesPatch } = require('diff');
  return changes.map(change => {
    const before = change.before === null ? '' : text(change.before), after = change.after === null ? '' : text(change.after);
    return before === undefined || after === undefined ? `${change.path}: binary file changed\n` : createTwoFilesPatch(change.path, change.path, before, after);
  }).join('\n');
}
function mergeText(base, ours, theirs) {
  const { diffArrays } = require('diff');
  const lines = value => value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const original = lines(base);
  function edits(value) {
    let offset = 0, pending;
    const output = [];
    for (const part of diffArrays(original, lines(value))) {
      if (!part.added && !part.removed) { if (pending) output.push(pending); pending = undefined; offset += part.count; }
      else {
        pending ??= { start: offset, end: offset, lines: [] };
        if (part.removed) { offset += part.count; pending.end = offset; }
        else pending.lines.push(...part.value);
      }
    }
    if (pending) output.push(pending);
    return output;
  }
  const left = edits(ours), right = edits(theirs), all = [...left];
  for (const edit of right) {
    let identical = false;
    for (const existing of left) {
      if (JSON.stringify(edit) === JSON.stringify(existing)) { identical = true; break; }
      // Adjacent changes can be merged; insertions at a changed boundary are conservative conflicts.
      if (Math.max(edit.start, existing.start) < Math.min(edit.end, existing.end) ||
          (edit.start === edit.end && edit.start >= existing.start && edit.start <= existing.end) ||
          (existing.start === existing.end && existing.start >= edit.start && existing.start <= edit.end)) return undefined;
    }
    if (!identical) all.push(edit);
  }
  let output = '', offset = 0;
  for (const edit of all.sort((a,b) => a.start - b.start)) { output += original.slice(offset, edit.start).join('') + edit.lines.join(''); offset = edit.end; }
  return output + original.slice(offset).join('');
}
function merge(base, ours, theirs) {
  const files = {}, conflicts = [];
  for (const name of Object.keys({ ...base, ...ours, ...theirs }).sort()) {
    const b = base[name], o = ours[name], t = theirs[name];
    let value;
    if (o === b || o === t) value = t;
    else if (t === b) value = o;
    else if (b !== undefined && o !== undefined && t !== undefined && [b,o,t].every(v => text(v) !== undefined)) {
      const merged = mergeText(text(b), text(o), text(t));
      if (merged !== undefined) value = Buffer.from(merged).toString('base64');
      else conflicts.push(name);
    } else conflicts.push(name);
    // Keep the new upstream file in conflicts. Original and modified versions remain in the request.
    if (conflicts.at(-1) === name) value = t;
    if (value !== undefined) files[name] = value;
  }
  return { files, conflicts };
}
function validateManifest(manifest) {
  if (manifest.schema !== 1 || !/^[a-f0-9]{64}$/.test(manifest.release) || manifest.runtime?.platform !== 'macos' || manifest.runtime?.mode !== 'release' || !manifest.project || !manifest.version) throw new Error('Invalid editable manifest');
  for (const asset of [manifest.source, manifest.toolkit]) if (!asset || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.-]+\/[\w.-]+$/.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Invalid editable asset');
  if (manifest.projectRoot !== undefined && manifest.projectRoot !== '.') safe('/snapshot', manifest.projectRoot);
  safe('/snapshot', manifest.entry);
  return manifest;
}
function prepare(manifest, source, toolkit, support) {
  validateManifest(manifest);
  const directory = path.join(support, 'releases', manifest.release);
  if (fs.existsSync(path.join(directory, 'state.json'))) {
    const accepting = path.join(directory, 'accepting.json');
    if (fs.existsSync(accepting)) {
      const pending = read(accepting);
      for (const file of [pending.backup, pending.staged]) if (path.dirname(file) !== directory) throw new Error('Invalid acceptance recovery path');
      if (!fs.existsSync(path.join(directory, 'work')) && fs.existsSync(pending.backup)) fs.renameSync(pending.backup, path.join(directory, 'work'));
      fs.rmSync(accepting, { force: true });
    }
    const state = read(path.join(directory, 'state.json'));
    if (state.toolkit !== toolkit) { state.toolkit = toolkit; write(path.join(directory, 'state.json'), state); }
    return directory;
  }
  const stage = `${directory}.pending-${process.pid}`;
  fs.mkdirSync(stage, { recursive: true });
  try {
    const base = snapshot(source);
    restore(path.join(stage, 'base'), base); restore(path.join(stage, 'work'), base);
    write(path.join(stage, 'manifest.json'), manifest);
    write(path.join(stage, 'state.json'), { schema: 1, toolkit, created: new Date().toISOString(), history: [], status: 'original' });
    fs.mkdirSync(path.dirname(directory), { recursive: true }); fs.renameSync(stage, directory);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return directory;
}
function migrate(from, to) {
  const previous = read(path.join(from, 'manifest.json')), current = read(path.join(to, 'manifest.json'));
  if (previous.project !== current.project || previous.release === current.release) throw new Error('Migration requires two releases of the same app');
  const state = read(path.join(to, 'state.json'));
  if (state.history.length || state.migration) throw new Error('This release already has edits or a migration; preserve it before preparing another');
  const base = snapshot(path.join(from, 'base')), ours = snapshot(path.join(from, 'work')), theirs = snapshot(path.join(to, 'base'));
  const result = merge(base, ours, theirs);
  const id = crypto.randomUUID(), candidate = path.join(to, 'candidates', id);
  restore(candidate, result.files);
  const history = read(path.join(from, 'state.json')).history;
  state.inheritedPrompts = [...(read(path.join(from, 'state.json')).inheritedPrompts ?? []), ...history.filter(item => item.status === 'accepted').map(item => ({ prompt: item.prompt, baseRelease: item.baseRelease, patch: item.patch }))];
  const request = { schema: 1, kind: 'migration', from: previous.release, to: current.release,
    prompts: [...state.inheritedPrompts, ...history.filter(item => item.status !== 'accepted')].map(item => ({ prompt: item.prompt, status: item.status, patch: item.patch })), patch: patch(base, ours),
    upstream: patch(base, theirs), conflicts: result.conflicts };
  write(path.join(to, 'migration.json'), request);
  fs.writeFileSync(path.join(to, 'review.txt'), 'Migration from ' + previous.version + ' to ' + current.version + '\n\nConflicts: ' + (result.conflicts.join(', ') || 'none') + '\n\nContributing prompts\n\n' + state.inheritedPrompts.map(item => item.prompt).join('\n\n') + '\n\nChanges from accepted source\n\n' + reviewPatch(patch(snapshot(path.join(to, 'work')), result.files)));
  state.migration = { from: previous.release, candidate: id, conflicts: result.conflicts, status: 'needs-review' };
  write(path.join(to, 'state.json'), state);
  return state.migration;
}
const children = new Set();
async function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    children.add(child); child.once('close', () => children.delete(child));
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { output = (output + value).slice(-20000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)} exited ${code}\n${output}`)));
  });
}
function attachDependencies(workspace, toolkit) {
  const modules = path.join(workspace, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(path.join(toolkit, 'node_modules'), modules);
}
async function build(directory, candidate = 'work') {
  fs.rmSync(path.join(directory, 'ready.json'), { force: true });
  const state = read(path.join(directory, 'state.json')), manifest = validateManifest(read(path.join(directory, 'manifest.json')));
  const workspace = candidate === 'work' ? path.join(directory, 'work') : safe(path.join(directory, 'candidates'), candidate);
  const toolkit = state.toolkit, metadata = read(path.join(toolkit, 'toolkit.json'));
  if (metadata.arch !== process.arch || metadata.framework !== manifest.runtime.framework || hash(fs.readFileSync(path.join(toolkit, 'hermesc'))) !== metadata.compiler) throw new Error('Incompatible editing toolkit');
  require('./editable-policy.cjs').assertEditableChanges(snapshot(path.join(directory, 'base')), snapshot(workspace), manifest.editing?.trustedFiles);
  attachDependencies(workspace, toolkit);
  const project = !manifest.projectRoot || manifest.projectRoot === '.' ? workspace : safe(workspace, manifest.projectRoot);
  attachDependencies(project, toolkit);
  const req = createRequire(path.join(project, 'package.json'));
  const expoPackage = req.resolve('expo/package.json'), expo = read(expoPackage);
  const bin = path.resolve(path.dirname(expoPackage), typeof expo.bin === 'string' ? expo.bin : expo.bin.expo);
  const id = crypto.randomUUID(), output = path.join(directory, 'builds', id);
  fs.mkdirSync(output, { recursive: true });
  const env = { ...process.env, CI: '1', NODE_ENV: 'production', SPARK_PLATFORM: 'macos', EXPO_NO_TELEMETRY: '1' };
  // Discover worker roots using the same two-pass pipeline as Spark's release build.
  // One worker avoids Bun's jest-worker fork/IPC incompatibility and keeps memory bounded.
  const args = ['export:embed', '--platform', 'macos', '--entry-file', manifest.entry, '--bundle-output', path.join(output, 'app.js'), '--sourcemap-output', path.join(output, 'app.map'), '--assets-dest', output, '--dev', 'false', '--minify', 'true', '--max-workers', '1'];
  await execute(process.execPath, [bin, ...args], { cwd: project, env: { ...env, SPARK_RUNTIME_DISCOVERY: '1' } });
  const sources = read(path.join(output, 'app.map')).sources;
  const roots = sources.map(source => fs.existsSync(path.resolve(project, source)) ? path.resolve(project, source) : path.resolve(project, source.replace(/^\//, ''))).filter(file => fs.existsSync(file) && /\.[jt]sx?$/.test(file) && !file.endsWith('.d.ts'));
  const runtimeSources = path.join(output, 'runtime-sources.json');
  write(runtimeSources, { enabled: sources.some(source => source.includes('@react-native-runtimes/core/') && !source.endsWith('secondary-runtime-polyfill.js')), roots });
  await execute(process.execPath, [bin, ...args], { cwd: project, env: { ...env, SPARK_RUNTIME_SOURCES: runtimeSources } });
  // A production edit may only import native modules present in the frozen shell.
  const selected = manifest.runtime.modules;
  for (const source of read(path.join(output, 'app.map')).sources) {
    const file = fs.existsSync(path.resolve(project, source)) ? path.resolve(project, source) : path.resolve(project, source.replace(/^\//, ''));
    if (!fs.existsSync(file)) continue;
    let folder = path.dirname(fs.realpathSync(file));
    while (folder !== path.dirname(folder)) {
      const packageFile = path.join(folder, 'package.json');
      if (fs.existsSync(packageFile)) {
        const pkg = read(packageFile);
        if ((pkg.codegenConfig || pkg.spark?.nativeModules || fs.existsSync(path.join(folder, 'expo-module.config.json'))) && !selected[pkg.name]) throw new Error(`Native module is not available in this shell: ${pkg.name}`);
        break;
      }
      folder = path.dirname(folder);
    }
  }
  await execute(path.join(toolkit, 'hermesc'), ['-O', '-emit-binary', '-out', path.join(output, 'main.jsbundle'), path.join(output, 'app.js')]);
  const record = { schema: 1, release: manifest.release, fingerprint: manifest.runtime.fingerprint, build: id, bundleHash: hash(fs.readFileSync(path.join(output, 'main.jsbundle'))), candidate, sourceHash: hash(JSON.stringify(snapshot(workspace))) };
  write(path.join(directory, 'ready.json'), record);
  return record;
}
function verify(directory) {
  const ready = read(path.join(directory, 'ready.json'));
  const manifest = validateManifest(read(path.join(directory, 'manifest.json')));
  const workspace = ready.candidate === 'work' ? path.join(directory, 'work') : safe(path.join(directory, 'candidates'), ready.candidate);
  if (ready.release !== manifest.release || ready.sourceHash !== hash(JSON.stringify(snapshot(workspace)))) throw new Error('Source changed after validation; rebuild before accepting');
  if (ready.fingerprint !== manifest.runtime.fingerprint || !/^[a-f0-9-]{36}$/.test(ready.build) || hash(fs.readFileSync(path.join(directory, 'builds', ready.build, 'main.jsbundle'))) !== ready.bundleHash) throw new Error('Compiled candidate is incompatible or corrupted');
  return ready;
}
function accept(directory) {
  const ready = verify(directory);
  const workspace = ready.candidate === 'work' ? path.join(directory, 'work') : safe(path.join(directory, 'candidates'), ready.candidate);
  const state = read(path.join(directory, 'state.json'));
  if (ready.candidate !== 'work') {
    const staged = path.join(directory, 'accept-' + crypto.randomUUID());
    fs.cpSync(workspace, staged, { recursive: true, verbatimSymlinks: true });
    const backup = path.join(directory, 'work-before-' + crypto.randomUUID());
    write(path.join(directory, 'accepting.json'), { backup, staged });
    fs.renameSync(path.join(directory, 'work'), backup);
    try { fs.renameSync(staged, path.join(directory, 'work')); fs.rmSync(path.join(directory, 'accepting.json'), { force: true }); }
    catch (error) { fs.rmSync(path.join(directory, 'work'), { recursive: true, force: true }); fs.renameSync(backup, path.join(directory, 'work')); throw error; }
    const event = state.history.find(item => item.candidate === ready.candidate);
    for (const item of state.history) if (item.candidate === ready.candidate || event?.ancestors?.includes(item.id)) item.status = 'accepted';
    if (state.migration?.candidate === ready.candidate) state.migration.status = 'accepted';
  }
  state.status = 'customized';
  write(path.join(directory, 'patch.json'), patch(snapshot(path.join(directory, 'base')), snapshot(path.join(directory, 'work'))));
  write(path.join(directory, 'state.json'), state);
  // Native host owns activation/recovery. Never modify a signed application from the worker.
  return ready;
}
module.exports = { reviewPatch, safe, snapshot, restore, patch, merge, mergeText, validateManifest, prepare, migrate, execute, build, verify, accept, read, write, hash };
if (require.main === module) {
  const initialize = require('./js-runtime.cjs').initializeRuntime;
  (async () => {
    await initialize();
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => { for (const child of children) child.kill(signal); setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 300).unref(); });
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === 'prepare') result = prepare(read(args[0]), args[1], args[2], args[3]);
    else if (command === 'migrate') result = migrate(args[0], args[1]);
    else if (command === 'build') result = await build(args[0], args[1]);
    else if (command === 'verify') result = verify(args[0]);
    else if (command === 'accept') result = accept(args[0]);
    else if (command === 'prompt') result = await require('./editable-ai.cjs').prompt(args[0], read(args[1]));
    else throw new Error('Expected prepare, migrate, prompt, build, verify, or accept');
    console.log(JSON.stringify(result));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
