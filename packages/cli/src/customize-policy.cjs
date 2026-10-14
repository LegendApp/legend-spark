const fs = require('node:fs');
const path = require('node:path');
// Configuration is executable input to compilation, never customize app source.
function isBuildConfig(file) {
  const name = path.posix.basename(file);
  return /(?:^|\/)(?:scripts|plugins|transforms)(?:\/|$)/i.test(file) || /(?:^|\.)config(?:\.|$)/i.test(name) || /^(?:app\.json|package\.json|tsconfig.*|jsconfig.*|babel\..*|metro\..*|\.babelrc.*)$/.test(name);
}
function isFixed(file, trustedFiles = []) {
  return trustedFiles.includes(file) || isBuildConfig(file) || /(?:^|\/)(?:\.|(?:macos|ios|android|windows|Pods)(?:\/|$))/i.test(file) ||
    /^(?:package\.json|app\.json|\.babelrc.*|babel\..*|metro\..*|tsconfig.*|jsconfig.*|.*lock.*|.*\.(?:sh|bash|zsh|ps1|rb|podspec))$/i.test(path.posix.basename(file));
}
function assertCustomizeChanges(before, after, trustedFiles = []) {
  for (const file of Object.keys({ ...before, ...after })) {
    if (before[file] !== after[file] && isFixed(file, trustedFiles)) throw new Error(`Build/native/dependency configuration is fixed: ${file}`);
  }
}
// Run only when publishing the signed source snapshot. Follow local executable
// imports so a transform cannot be edited indirectly through an innocuous name.
function collectTrustedFiles(root) {
  const ts = require('typescript');
  const trusted = new Set();
  function visit(file) {
    file = file.split(path.sep).join('/');
    if (trusted.has(file)) return;
    trusted.add(file);
    if (/\.json$/.test(file) || /^\.babelrc$/.test(path.basename(file))) {
      const parsed = ts.parseConfigFileTextToJson(file, fs.readFileSync(path.join(root, file), 'utf8'));
      if (parsed.error) throw new Error(`Invalid build configuration JSON: ${file}`);
      const data = parsed.config;
      function jsonDependencies(value, key = '') {
        if (typeof value === 'string' && value.startsWith('.') && ['plugins', 'presets', 'extends', 'babelTransformerPath', 'transformerPath'].includes(key)) dependency(value);
        else if (Array.isArray(value)) for (const item of value) jsonDependencies(item, key);
        else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) jsonDependencies(item, name);
      }
      jsonDependencies(data); return;
    }
    if (!/\.[cm]?[jt]sx?$/.test(file)) return;
    const tree = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    function dependency(specifier) {
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return; // frozen toolkit dependency
      const target = path.resolve(root, path.dirname(file), specifier);
      if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Build configuration imports outside the snapshot: ${file}`);
      const packageFile = path.join(target, 'package.json');
      const packageEntry = fs.existsSync(packageFile) && fs.statSync(target).isDirectory() ? JSON.parse(fs.readFileSync(packageFile, 'utf8')).main : undefined;
      if (packageEntry) visit(path.relative(root, packageFile));
      const resolved = [target, ...(packageEntry ? [path.resolve(target, packageEntry)] : []), ...['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '/index.js', '/index.ts'].map(suffix => target + suffix)].find(name => fs.existsSync(name) && fs.statSync(name).isFile());
      if (!resolved) throw new Error(`Missing build configuration dependency in snapshot: ${file} -> ${specifier}`);
      if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Build configuration dependency escapes snapshot: ${file}`);
      if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error(`Build configuration dependency is a symlink: ${file}`);
      visit(path.relative(root, resolved));
    }
    const variables = new Map();
    function collect(node) {
      if (ts.isVariableDeclaration(node) && (node.parent.flags & ts.NodeFlags.Const) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
      ts.forEachChild(node, collect);
    }
    collect(tree);
    function fixedTarget(node, seen = new Set()) {
      if (ts.isParenthesizedExpression(node)) return fixedTarget(node.expression, seen);
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return fixedTarget(variables.get(node.text), new Set([...seen, node.text]));
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return fixedTarget(node.right, seen);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === 'path' && ['join', 'resolve'].includes(node.expression.name.text)) {
        const last = node.arguments.at(-1);
        return last && ts.isStringLiteralLike(last) && /(?:^|\.)config\.[cm]?[jt]s$/.test(last.text) && path.basename(last.text) === last.text;
      }
      return false;
    }
    function walk(node) {
      if (ts.isStringLiteralLike(node) && node.text.startsWith('.')) {
        let owner = node.parent;
        while (ts.isArrayLiteralExpression(owner)) owner = owner.parent;
        if (ts.isPropertyAssignment(owner) && ['plugins', 'presets', 'extends', 'babelTransformerPath', 'transformerPath'].includes(owner.name.getText(tree).replace(/['"]/g, ''))) dependency(node.text);
        const target = path.resolve(root, path.dirname(file), node.text);
        const candidates = fs.existsSync(target) && fs.statSync(target).isDirectory() ? [] : path.extname(target) ? [target] : [target, ...['.js', '.cjs', '.mjs', '.ts', '.tsx', '/index.js', '/index.ts'].map(suffix => target + suffix)];
        for (const name of candidates) {
          if (!name.startsWith(path.resolve(root) + path.sep)) throw new Error(`Build configuration references outside the snapshot: ${file}`);
          if (fs.existsSync(name)) dependency('./' + path.relative(path.dirname(path.join(root, file)), name));
          else trusted.add(path.relative(root, name).split(path.sep).join('/'));
        }
      }
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === 'require' && node.expression.name.text === 'resolve'))) specifier = node.arguments[0];
      if (specifier) {
        if (ts.isStringLiteralLike(specifier)) dependency(specifier.text);
        else if (!fixedTarget(specifier)) throw new Error(`Build configuration must use static imports or a fixed config basename: ${file}`);
      }
      ts.forEachChild(node, walk);
    }
    walk(tree);
  }
  function scan(directory = '') {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      const relative = path.join(directory, name), info = fs.lstatSync(path.join(root, relative));
      if (info.isSymbolicLink()) throw new Error(`Source snapshot contains a symlink: ${relative}`);
      if (info.isDirectory()) { if (name !== 'node_modules') scan(relative); }
      else if (isBuildConfig(relative.split(path.sep).join('/'))) visit(relative);
    }
  }
  scan(); return [...trusted].sort();
}
module.exports = { isBuildConfig, isFixed, assertCustomizeChanges, collectTrustedFiles };
