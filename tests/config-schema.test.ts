import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import ts from "typescript";
import Ajv2020 from "ajv/dist/2020.js";
import { config as updatesConfig } from "./fixtures/config-updates.ts";
import { toExpo } from "../packages/config-plugin/config.cjs";
test("owned configuration schema keys track the public TypeScript contract", () => {
  const source = resolve("packages/config-plugin/config.d.cts");
  const fixture = resolve("tests/fixtures/config-updates.ts");
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const program = ts.createProgram([source, fixture], options), checker = program.getTypeChecker();
  expect(program.getSemanticDiagnostics(program.getSourceFile(fixture)!).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(source)!)!);
  const schema = JSON.parse(readFileSync("packages/config-plugin/schema.json", "utf8"));
  for (const [name, shape] of [
    ["SparkApplicationConfig", schema], ["MacOSConfiguration", schema.properties.macos],
    ["MacOSLifecycle", schema.properties.macos.properties.lifecycle], ["SigningConfiguration", schema.properties.signing],
    ["DocumentType", schema.properties.documentTypes.items], ["UpdateConfiguration", schema.properties.updates],
    ["WindowConfiguration", schema.properties.window], ["CustomizeConfiguration", schema.properties.customize.oneOf[1]],
  ] as const) {
    let symbol = symbols.find(symbol => symbol.name === name)!;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    expect(type.getProperties().map(property => property.name).sort(), name).toEqual(Object.keys(shape.properties).sort());
  }
}, 30_000); // Type-checks the config declarations with a TypeScript program: under a second locally, up to 2.7 s on a loaded CI runner.
test("delta configuration is accepted by the public config and bounded in both shipped schemas", () => {
  expect(toExpo(updatesConfig).expo.extra.spark.updates).toEqual(updatesConfig.updates);
  for (const file of ["packages/config-plugin/schema.json", "packages/desktop/schema.json"]) {
    const schema = JSON.parse(readFileSync(file, "utf8"));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(updatesConfig), file).toBe(true);
    for (const maximumDeltas of [undefined, 0, 10]) expect(validate({ ...updatesConfig, updates: { ...updatesConfig.updates, maximumDeltas } }), file).toBe(true);
    for (const maximumDeltas of [-1, 1.5, 11, "3", null]) expect(validate({ ...updatesConfig, updates: { ...updatesConfig.updates, maximumDeltas } }), file).toBe(false);
  }
});
