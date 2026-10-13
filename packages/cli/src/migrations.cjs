const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const skillPath = 'node_modules/@legendapp/spark/skills/spark/SKILL.md';
const start = '<!-- spark:skill:start -->';
const end = '<!-- spark:skill:end -->';
const pointer = `${start}\nFrom the app root, read [Spark's app development skill](${skillPath}) before working on this app.\nThe installed Spark version owns these instructions; do not copy them here.\n${end}`;
const claudePointer = `---\nname: spark\ndescription: Develop, build, diagnose, or upgrade a Legend Spark desktop app.\n---\n\n${pointer}\n`;

function mergePointer(source) {
  const first = source.indexOf(start);
  const last = source.indexOf(end);
  if (first === -1 && last === -1) return source + (source ? (source.endsWith('\n') ? '\n' : '\n\n') : '') + pointer + '\n';
  if (first === -1 || last < first || source.indexOf(start, first + start.length) !== -1 || source.indexOf(end, last + end.length) !== -1) {
    throw new Error('Malformed Spark skill markers. Repair the spark:skill section, then run spark upgrade.');
  }
  return source.slice(0, first) + pointer + source.slice(last + end.length);
}

function refreshPointers(root) {
  const edits = ['AGENTS.md', 'CLAUDE.md'].map(name => {
    const file = path.join(root, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    return { file, before, after: mergePointer(before) };
  });
  const file = path.join(root, '.claude/skills/spark/SKILL.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // A pre-existing user skill keeps its frontmatter and instructions.
  edits.push({ file, before, after: !before || before === claudePointer ? claudePointer : mergePointer(before) });
  for (const { file, before, after } of edits) {
    if (before === after) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after);
  }
}

// Keep released migration versions fixed. New steps must be idempotent; only
// steps that preserve user configuration and need no install may run at startup.
const migrations = [{ version: '0.0.1-next.4', automatic: true, apply: refreshPointers }];

function installedSparkVersion(root) {
  const file = createRequire(path.join(root, 'package.json')).resolve('@legendapp/spark/package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function migrateProject(root, version, automatic = true) {
  const { compare, valid } = createRequire(require.resolve('npm/package.json'))('semver');
  const file = path.join(root, '.spark/version');
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : undefined;
  if (!valid(version) || (previous !== undefined && (!valid(previous) || compare(previous, version) > 0))) {
    throw new Error(`Spark project version ${previous ?? '(unrecorded)'} cannot migrate to ${version}. Run spark upgrade.`);
  }
  if (previous === version) return [];
  const pending = migrations.filter(step => (!previous || compare(step.version, previous) > 0) && compare(step.version, version) <= 0);
  if (automatic && pending.some(step => !step.automatic)) throw new Error('Spark has pending migrations that require an install or configuration changes. Run spark upgrade.');
  for (const step of pending) step.apply(root);
  // Record only successful migrations. A failed/partial attempt is safe to retry.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, version + '\n');
  fs.renameSync(temporary, file);
  return pending.map(step => step.version);
}

module.exports = { pointer, claudePointer, mergePointer, refreshPointers, migrations, installedSparkVersion, migrateProject };
