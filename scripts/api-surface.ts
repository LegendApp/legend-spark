import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** One public `@legendapp/spark` subpath: its runtime exports, its type-only exports and its availability flags. */
export type SdkEntry = {
  values: string[];
  types: string[];
  /** Per `get*Availability` export, the flags it reports, as call-and-property suffixes: `().available`, `(button).available`. */
  flags: Record<string, string[]>;
};
export type SdkSurface = Record<string, SdkEntry>;

const repo = path.resolve(import.meta.dirname, "..");
const sdk = path.join(repo, "packages/desktop");
const AVAILABILITY = /^get\w*Availability$/;

function availabilityFlags(checker: ts.TypeChecker, symbol: ts.Symbol, at: ts.Node): string[] {
  const signature = checker.getTypeOfSymbolAtLocation(symbol, at).getCallSignatures()[0];
  if (!signature) throw new Error(`${symbol.name} is not a function`);
  const parameter = signature.parameters[0] && checker.getTypeOfSymbolAtLocation(signature.parameters[0], at);
  const members = parameter?.isUnion() ? parameter.types : parameter ? [parameter] : [];
  const args = members.length && members.every(type => type.isStringLiteral()) ? members.map(type => (type as ts.StringLiteralType).value) : [""];
  const result = checker.getAwaitedType(signature.getReturnType()) ?? signature.getReturnType();
  const booleans = checker.getPropertiesOfType(result).filter(property => checker.getTypeOfSymbolAtLocation(property, at).flags & ts.TypeFlags.BooleanLike).map(property => property.name);
  if (!booleans.length) throw new Error(`${symbol.name} returns no boolean flag`);
  return args.flatMap(arg => booleans.map(flag => `(${arg}).${flag}`));
}

/**
 * The public SDK surface: every subpath in packages/desktop/package.json `exports`, and for TypeScript
 * entries every export the type checker sees. docs/api-public-surface.json snapshots the export names.
 */
export function readSdkSurface(): SdkSurface {
  const exports = JSON.parse(readFileSync(path.join(sdk, "package.json"), "utf8")).exports as Record<string, string>;
  const entries = Object.entries(exports).filter(([, file]) => file.endsWith(".ts"));
  const config = ts.readConfigFile(path.join(repo, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, repo).options;
  const program = ts.createProgram(entries.map(([, file]) => path.join(sdk, file)), options);
  const checker = program.getTypeChecker();
  const surface: SdkSurface = Object.fromEntries(Object.keys(exports).sort().map(subpath => [subpath, { values: [], types: [], flags: {} }]));
  for (const [subpath, file] of entries) {
    const source = program.getSourceFile(path.join(sdk, file))!;
    const entry = surface[subpath]!;
    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source)!)) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (!(target.flags & ts.SymbolFlags.Value)) { entry.types.push(symbol.name); continue; }
      entry.values.push(symbol.name);
      if (AVAILABILITY.test(symbol.name)) entry.flags[symbol.name] = availabilityFlags(checker, target, source);
    }
    entry.values.sort();
    entry.types.sort();
  }
  return surface;
}
