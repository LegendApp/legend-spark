import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// Every public hook must be either an adapter over a public imperative API or
// inherently tied to React context/rendering. Adding a hook requires this review.
const policy: Record<string, Record<string, { imperative: string } | { reactOnly: string }>> = {
  "./audio": { useAudioPlayer: { imperative: "createAudioPlayer" } },
  "./menus": { useMenu: { imperative: "createMenu" } },
  "./shortcuts/commands": {
    useRoutedHotkeys: { imperative: "createHotkeyRouter" },
    useHotkeySuspension: { imperative: "createHotkeyRouter" },
  },
  "./windows": {
    usePrimaryWindowLifecycle: { imperative: "createPrimaryWindowLifecycle" },
    useWindowFocusEffect: { imperative: "addWindowListener" },
    useWindowId: { reactOnly: "Reads the nearest WindowProvider; imperative callers already supply explicit window IDs." },
  },
  "./app/documents": {
    useDocumentAppController: { imperative: "createDocumentAppController" },
    useWatchedDocumentReload: { imperative: "watchDocumentReload" },
  },
};

test("all public hooks declare a public imperative core or a React-only rationale", () => {
  const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
  const entries = Object.entries(exports).filter(([, path]) => path.endsWith(".ts"));
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const program = ts.createProgram(entries.map(([, path]) => resolve("packages/desktop", path)), options);
  const checker = program.getTypeChecker();
  const publicHooks: Record<string, string[]> = {};
  const unalias = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  for (const [entry, path] of entries) {
    const source = program.getSourceFile(resolve("packages/desktop", path))!;
    const module = checker.getSymbolAtLocation(source)!;
    const symbols = checker.getExportsOfModule(module);
    const hooks = symbols.filter(symbol => /^use[A-Z]/.test(symbol.name) && (unalias(symbol).flags & ts.SymbolFlags.Value));
    if (hooks.length) publicHooks[entry] = hooks.map(symbol => symbol.name).sort();
    for (const hook of hooks) {
      const rule = policy[entry]?.[hook.name];
      expect(rule, `${entry}:${hook.name}: classify this hook using docs/api-design.md`).toBeDefined();
      if (rule && "imperative" in rule) {
        const core = symbols.find(symbol => symbol.name === rule.imperative);
        expect(core, `${entry} must export ${rule.imperative}`).toBeDefined();
        const declaration = core && unalias(core).valueDeclaration;
        expect(declaration, `${entry}:${rule.imperative} must be implemented`).toBeDefined();
        if (declaration) {
          expect(checker.getTypeOfSymbolAtLocation(unalias(core!), declaration).getCallSignatures().length).toBeGreaterThan(0);
          // Keep React lifecycle code out of the imperative implementation file.
          // Re-exporting hooks from the same feature entry point is deliberately allowed.
          const importsReact = declaration.getSourceFile().statements.some(statement => ts.isImportDeclaration(statement)
            && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "react");
          expect(importsReact, `${rule.imperative}: move React bindings into a hooks module`).toBe(false);
        }
      } else if (rule) expect(rule.reactOnly.length).toBeGreaterThan(20);
    }
  }
  expect(publicHooks).toEqual(Object.fromEntries(Object.entries(policy).map(([entry, rules]) => [entry, Object.keys(rules).sort()])));
}, 30000);
