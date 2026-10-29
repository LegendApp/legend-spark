// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createMigrationContext, resolveDependency } = require('./migration-helpers.cjs');

const skillPath = 'node_modules/@legendapp/spark/skills/spark/SKILL.md';
const start = '<!-- spark:skill:start -->';
const end = '<!-- spark:skill:end -->';
const pointer = `${start}\nFrom the app root, read [Spark's app development skill](${skillPath}) before working on this app.\nThe installed Spark version owns these instructions; do not copy them here.\n${end}`;
const claudePointer = `---\nname: spark\ndescription: Develop, build, diagnose, or upgrade a Legend Spark desktop app.\n---\n\n${pointer}\n`;

/** @param {string} source */
function mergePointer(source) {
  const first = source.indexOf(start);
  const last = source.indexOf(end);
  if (first === -1 && last === -1) return source + (source ? (source.endsWith('\n') ? '\n' : '\n\n') : '') + pointer + '\n';
  if (first === -1 || last < first || source.indexOf(start, first + start.length) !== -1 || source.indexOf(end, last + end.length) !== -1) {
    throw new Error('Malformed Spark skill markers. Repair the spark:skill section, then run spark upgrade.');
  }
  return source.slice(0, first) + pointer + source.slice(last + end.length);
}

/** @param {import('./migration-helpers.cjs').MigrationContext} context */
function planPointers(context) {
  const edits = ['AGENTS.md', 'CLAUDE.md'].map(name => {
    const file = name;
    const before = context.readFile(file) ?? '';
    return { file, before, after: mergePointer(before) };
  });
  const file = '.claude/skills/spark/SKILL.md';
  const before = context.readFile(file) ?? '';
  // A pre-existing user skill keeps its frontmatter and instructions.
  edits.push({ file, before, after: !before || before === claudePointer ? claudePointer : mergePointer(before) });
  for (const { file, before, after } of edits) {
    if (before === after) continue;
    context.writeFile(file, after);
  }
}

/** @param {string} root */
function refreshPointers(root) {
  const changes = new Map();
  planPointers(createMigrationContext(root, '', changes, []));
  writeChanges(root, [...changes.values()]);
}

/** @param {import('./migration-helpers.cjs').MigrationContext} context */
function upgradeWindowConfig(context) {
  for (const file of ['desktop.config.json', 'app.json']) {
    context.editJson(file, /** @param {{ window?: import('./migration-helpers.cjs').JsonObject; expo?: { extra?: { spark?: { window?: import('./migration-helpers.cjs').JsonObject } } } }} config */ config => {
      const options = file === 'desktop.config.json' ? config.window : config.expo?.extra?.spark?.window;
      if (!options) return;
      if (typeof options !== 'object' || Array.isArray(options)) { context.manualStep(`Repair window configuration in ${file}; expected an object.`); return; }
      for (const [nested, width, height] of [['size', 'width', 'height'], ['minSize', 'minWidth', 'minHeight'], ['maxSize', 'maxWidth', 'maxHeight']]) {
        if (!(width in options) && !(height in options)) continue;
        if (typeof options[width] !== 'number' || typeof options[height] !== 'number' || options[nested] !== undefined) {
          context.manualStep(`Merge legacy ${width}/${height} into window.${nested} in ${file}; incomplete or conflicting dimensions need review.`);
        } else {
          options[nested] = { width: options[width], height: options[height] };
          delete options[width]; delete options[height];
        }
      }
      if ('restoreFrame' in options) {
        if ('restoreBounds' in options && options.restoreBounds !== options.restoreFrame) context.manualStep(`Resolve window.restoreFrame/restoreBounds in ${file}.`);
        else { options.restoreBounds = options.restoreFrame; delete options.restoreFrame; }
      }
      for (const [legacy, nested] of [['material', 'backgroundMaterial'], ['trafficLights', 'titleBar']]) {
        if (!(legacy in options)) continue;
        const macos = /** @type {import('./migration-helpers.cjs').JsonObject} */ (options.macos ?? {});
        if (typeof macos !== 'object' || Array.isArray(macos) || macos[nested] !== undefined) context.manualStep(`Merge window.${legacy} into window.macos.${nested} in ${file}.`);
        else {
          macos[nested] = legacy === 'trafficLights' ? { trafficLights: options[legacy] } : options[legacy];
          options.macos = macos; delete options[legacy];
        }
      }
    });
  }
}

// Keep released migration versions fixed. New steps must be idempotent; only
// steps that preserve user configuration and need no install may run at startup.
/** @type {import('./migrations.cjs').Migration[]} */
const migrations = [
  {
    version: '0.0.1-next.3', automatic: false, breaking: true,
    apply(context) {
      upgradeWindowConfig(context);
      context.replaceImport('@legendapp/spark/message-dialog', '@legendapp/spark/dialogs');
      context.replaceImport('@legendapp/spark/expo-metro', '@legendapp/spark/metro');
      context.manualStep('Review next.3 API contracts: dialogs/files, windows, registrations, settings, menus, shortcuts, processes, links, audio, notifications, updates, UI, removed universal tooling, and native lifecycle. Adapt arguments, results and cleanup; rebuild custom native modules.');
    },
  },
  { version: '0.0.1-next.4', automatic: true, apply(context) {
    planPointers(context);
    context.manualStep('If the app uses a custom runtime, rebuild it for next.4 native dependency patches; review production module selection and affected SidebarSplitView/Windows native flows.');
  } },
  // At release, align this version, UPGRADING.md, and migrations.test.ts with the first release without ./camera.
  { version: '0.0.2-next.0', automatic: false, breaking: true, apply(context) {
    context.manualStep('Apps importing @legendapp/spark/markdown, /html, /webview or /sqlite must add the corresponding optional backend to app dependencies. See the linked upgrade notes for library names and version pins; run spark doctor and rebuild custom runtimes.');
    context.manualStep('@legendapp/spark/camera was removed. Install the camera libraries in your app; see the linked upgrade notes for exact version pins. Import camera APIs directly from react-native-vision-camera, and NitroImage / Image from react-native-nitro-image. Spark still applies its version-pinned native patches automatically when your app depends on these libraries. Rebuild custom runtimes.');
  } },
];

/** @param {string} root */
function installedSparkVersion(root) {
  const file = createRequire(path.join(root, 'package.json')).resolve('@legendapp/spark/package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

/** @type {typeof import('./migrations.cjs').planMigrations} */
function planMigrations(root, version, { automatic = false, fromVersion } = {}) {
  const { compare, valid } = createRequire(resolveDependency(root, 'npm/package.json'))('semver');
  const file = path.join(root, '.spark/version');
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : fromVersion;
  if (!valid(version) || (previous !== undefined && (!valid(previous) || compare(previous, version) > 0))) {
    throw new Error(`Spark project version ${previous ?? '(unrecorded)'} cannot migrate to ${version}. Run spark upgrade.`);
  }
  const pending = migrations.filter(step => (!previous || compare(step.version, previous) > 0) && compare(step.version, version) <= 0).sort((a, b) => compare(a.version, b.version));
  if (automatic && pending.some(step => !step.automatic)) throw new Error('Spark has pending migrations that require an install or configuration changes. Run spark upgrade.');
  const changes = new Map();
  /** @type {import('./migration-helpers.cjs').ManualStep[]} */
  const manualSteps = [];
  for (const step of pending) step.apply(createMigrationContext(root, step.version, changes, manualSteps));
  planPointers(createMigrationContext(root, version, changes, manualSteps));
  if (manualSteps.length) {
    const context = createMigrationContext(root, version, changes, manualSteps);
    const notesFile = '.spark/upgrade-notes.md';
    let notes = context.readFile(notesFile) ?? '# Spark upgrade manual steps\n\nComplete these steps using the installed version notes. Keep this file until reviewed.\n';
    for (const step of manualSteps) {
      const entry = `- [ ] [${step.version}](../${step.notes}): ${step.message}`;
      if (!notes.replaceAll('- [x]', '- [ ]').includes(entry)) notes += '\n' + entry + '\n';
    }
    context.writeFile(notesFile, notes);
  }
  return { previous, version, versions: pending.map(step => step.version), changes: [...changes.values()].filter(change => change.before !== change.after), manualSteps };
}

/** @param {string} root @param {import('./migration-helpers.cjs').FileChange[]} changes */
function writeChanges(root, changes) {
  const context = createMigrationContext(root, '', new Map(), []);
  for (const change of changes) {
    if (context.readFile(change.file) !== change.before) throw new Error(`Migration input changed: ${change.file}. Run spark upgrade again.`);
  }
  for (const { file, after } of changes) {
    const destination = path.join(root, file);
    if (after === null) fs.unlinkSync(destination);
    else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, after);
      fs.renameSync(temporary, destination);
    }
  }
}

/** @type {typeof import('./migrations.cjs').applyMigrationPlan} */
function applyMigrationPlan(root, plan, recordVersion = true) {
  writeChanges(root, plan.changes);
  if (recordVersion) recordProjectVersion(root, plan.version);
}

/** @type {typeof import('./migrations.cjs').recordProjectVersion} */
function recordProjectVersion(root, version) {
  const file = path.join(root, '.spark/version');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === version + '\n') return;
  // Record only successful migrations. A failed/partial attempt is safe to retry.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, version + '\n');
  fs.renameSync(temporary, file);
}

/** @type {typeof import('./migrations.cjs').migrateProject} */
function migrateProject(root, version, automatic = true, options = {}) {
  const plan = planMigrations(root, version, { ...options, automatic });
  applyMigrationPlan(root, plan);
  return plan.versions;
}

/** @type {typeof import('./migrations.cjs').printMigrationPlan} */
function printMigrationPlan(plan) {
  console.log(`Migrations: ${plan.versions.join(' → ') || '(none pending)'}`);
  for (const change of plan.changes) console.log(`  ${change.after === null ? 'Delete' : change.before === null ? 'Create' : 'Edit'} ${change.file}`);
  for (const step of plan.manualSteps) console.log(`Manual step (${step.version}): ${step.message}\n  See ${step.notes}`);
  console.log('Review .spark/upgrade-notes.md for outstanding manual steps after upgrading.');
}

module.exports = { pointer, claudePointer, mergePointer, refreshPointers, migrations, installedSparkVersion, migrateProject, planMigrations, applyMigrationPlan, recordProjectVersion, printMigrationPlan };
