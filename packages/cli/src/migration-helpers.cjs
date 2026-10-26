// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const upgradeNotesPath = 'node_modules/@legendapp/spark/skills/spark/UPGRADING.md';

// `spark upgrade` loads these helpers from a downloaded release without its own
// node_modules, so dependencies may only resolve through the app's installed Spark.
/** @type {typeof import('./migration-helpers.cjs').resolveDependency} */
function resolveDependency(root, request) {
  try {
    return require.resolve(request);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'MODULE_NOT_FOUND') throw error;
    const spark = createRequire(path.join(root, 'package.json')).resolve('@legendapp/spark/package.json');
    return createRequire(spark).resolve(request);
  }
}

/** @type {typeof import('./migration-helpers.cjs').createMigrationContext} */
function createMigrationContext(root, version, changes, manualSteps) {
  root = fs.realpathSync(root);
  /** @param {string} file */
  function location(file) {
    const absolute = path.resolve(root, file);
    if (absolute === root || !absolute.startsWith(root + path.sep)) throw new Error(`Migration path must stay in the app: ${file}`);
    // Never follow app symlinks into another workspace or installed dependency.
    for (let current = absolute; current !== root; current = path.dirname(current)) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Migration path is a symlink: ${file}`);
    }
    return { absolute, relative: path.relative(root, absolute).split(path.sep).join('/') };
  }
  /** @type {import('./migration-helpers.cjs').MigrationContext} */
  const context = {
    readFile(file) {
      const { absolute, relative } = location(file);
      const change = changes.get(relative);
      if (change) return change.after;
      return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
    },
    writeFile(file, after) {
      const { relative } = location(file);
      const change = changes.get(relative);
      const before = change ? change.before : context.readFile(file);
      changes.set(relative, { file: relative, before, after });
    },
    editJson(file, edit) {
      const before = context.readFile(file);
      if (before === null) return;
      try {
        const value = JSON.parse(before);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          context.manualStep(`Edit ${file} manually; expected a JSON object.`);
          return;
        }
        const original = JSON.stringify(value);
        edit(value);
        if (JSON.stringify(value) !== original) {
          const indent = before.match(/\n([\t ]+)\S/)?.[1] ?? '  ';
          const newline = before.includes('\r\n') ? '\r\n' : '\n';
          context.writeFile(file, JSON.stringify(value, null, indent).replaceAll('\n', newline) + (before.endsWith('\n') ? newline : ''));
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        context.manualStep(`Edit ${file} manually; it is not valid JSON: ${error.message}`);
      }
    },
    renameFile(from, to) {
      const content = context.readFile(from);
      if (content === null) return;
      if (context.readFile(to) !== null) {
        context.manualStep(`Move ${from} to ${to}; the destination already exists. Preserve both files.`);
        return;
      }
      context.writeFile(to, content);
      const { relative } = location(from);
      const change = changes.get(relative);
      const before = change ? change.before : content;
      changes.set(relative, { file: relative, before, after: null });
    },
    updateTemplate(file, previous, next) {
      const content = context.readFile(file);
      if (content === null || content === previous) context.writeFile(file, next);
      else if (content !== next) context.manualStep(`Merge the new template for ${file}; the app has customized it.`);
    },
    manualStep(message) {
      const notes = `${upgradeNotesPath}#${version.replaceAll('.', '')}`;
      if (!manualSteps.some(step => step.version === version && step.message === message)) manualSteps.push({ version, message, notes });
    },
    replaceImport(from, to, names = {}) {
      /** @type {typeof import('typescript')} */
      const ts = require(resolveDependency(root, 'typescript'));
      const files = new Set();
      /** @param {string} directory */
      function visit(directory) {
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
          const file = path.posix.join(directory, entry.name);
          if (entry.isDirectory() && !['node_modules', '.git', '.spark', 'spark-packages', 'build', 'dist', 'Pods'].includes(entry.name)) visit(file);
          else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(file)) files.add(file);
        }
      }
      visit('');
      for (const file of changes.keys()) if (/\.[cm]?[jt]sx?$/.test(file)) files.add(file);
      for (const file of files) {
        const content = context.readFile(file);
        if (content === null || !content.includes(from)) continue;
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
        if (/** @type {import('typescript').SourceFile & { parseDiagnostics: readonly import('typescript').Diagnostic[] }} */ (source).parseDiagnostics.length) {
          context.manualStep(`Update imports from ${from} in ${file}; the source could not be parsed.`);
          continue;
        }
        /** @type {{ start: number; end: number; text: string }[]} */
        const edits = [];
        // A locally bound require is not necessarily the CommonJS loader.
        let shadowedRequire = false;
        /** @param {import('typescript').Node} node */
        function findRequireBinding(node) {
          if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node) || ts.isImportSpecifier(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === 'require') shadowedRequire = true;
          ts.forEachChild(node, findRequireBinding);
        }
        findRequireBinding(source);
        /** @param {import('typescript').Node} node */
        function inspect(node) {
          if (ts.isStringLiteralLike(node) && node.text === from) {
            const parent = node.parent;
            if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) {
              const bindings = ts.isImportDeclaration(parent) ? parent.importClause?.namedBindings : parent.exportClause;
              if (Object.keys(names).length && (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) || (ts.isImportDeclaration(parent) && parent.importClause?.name))) {
                context.manualStep(`Update renamed APIs from ${from} in ${file}; namespace/default imports need review.`);
                return;
              }
              if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
                for (const specifier of bindings.elements) {
                  const imported = specifier.propertyName ?? specifier.name;
                  const replacement = names[imported.text];
                  if (replacement && replacement !== imported.text) edits.push({ start: imported.getStart(source), end: imported.end, text: specifier.propertyName ? replacement : `${replacement} as ${specifier.name.text}` });
                }
              }
            } else if (ts.isCallExpression(parent) && parent.arguments[0] === node && parent.arguments.length === 1 &&
              (parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'))) {
              if (shadowedRequire && ts.isIdentifier(parent.expression)) {
                context.manualStep(`Review ${from} in ${file}; require is locally bound.`);
                return;
              }
              if (Object.keys(names).length) {
                context.manualStep(`Update renamed APIs from ${from} in ${file}; require/dynamic imports need review.`);
                return;
              }
            } else {
              context.manualStep(`Review the reference to ${from} in ${file}; it is not a supported import.`);
              return;
            }
            edits.push({ start: node.getStart(source) + 1, end: node.end - 1, text: to });
          }
          ts.forEachChild(node, inspect);
        }
        inspect(source);
        let after = content;
        for (const edit of edits.sort((a, b) => b.start - a.start)) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
        if (after !== content) context.writeFile(file, after);
      }
    },
  };
  return context;
}

module.exports = { createMigrationContext, resolveDependency, upgradeNotesPath };
