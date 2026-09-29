import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import ts from "typescript";
test("owned configuration schema keys track the public TypeScript contract", () => {
  const source = resolve("packages/config-plugin/config.d.cts");
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const program = ts.createProgram([source], options), checker = program.getTypeChecker();
  const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(source)!)!);
  const schema = JSON.parse(readFileSync("packages/config-plugin/schema.json", "utf8"));
  for (const [name, shape] of [
    ["SparkApplicationConfig", schema], ["MacOSConfiguration", schema.properties.macos],
    ["MacOSLifecycle", schema.properties.macos.properties.lifecycle], ["SigningConfiguration", schema.properties.signing],
    ["DocumentType", schema.properties.documentTypes.items], ["UpdateConfiguration", schema.properties.updates],
    ["WindowConfiguration", schema.properties.window],
  ] as const) {
    let symbol = symbols.find(symbol => symbol.name === name)!;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    expect(type.getProperties().map(property => property.name).sort(), name).toEqual(Object.keys(shape.properties).sort());
  }
});
