import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { KS_APP_ENTITIES, KS_APP_ENUMS, KS_APP_INTENTS } from "../examples/kitchen-sink/screens/system-integration/app-intents-config.ts";
import { runOk } from "./subprocess.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { validateAppIntents, appIntentDeclarations, appEntityDeclarations, appIntentsStrings, appIntentsSwift, withAppIntents, checkAppIntentsMetadata } = require("../packages/config-plugin/app-intents.cjs");
const { toExpo } = require("../packages/config-plugin/config.cjs");

const LANGUAGES = ["en", "ar", "fr"];
const INTENTS = [
  { id: "showRecipe", title: "Show Recipe", description: "Shows a \"recipe\"\nwith its steps", returnsText: true, openApp: true,
    parameters: [{ name: "recipe", title: "Recipe", type: "string" }, { name: "servings", title: "Servings", type: "integer", optional: true }],
    shortcut: { phrases: ["Show a recipe in ${applicationName}", "${applicationName} recipe"], shortTitle: "Show Recipe", systemImage: "fork.knife" } },
  { id: "startTimer", title: "Start Timer", parameters: [{ name: "minutes", title: "Minutes", type: "number", default: 2.5 }, { name: "loud", title: "Loud", type: "boolean", optional: true }] },
  { id: "ping", title: "Ping \\ \"pong\"\u0001\t\u007f" },
  { id: "cook", title: { en: "Cook", ar: "اطبخ", fr: "Cuisiner" }, description: { en: "Cooks a dish", ar: "يطبخ طبقًا", fr: "Cuisine un plat" },
    parameters: [{ name: "dish", title: { en: "Dish", ar: "طبق", fr: "Plat" }, type: "Dish", default: "default" }, { name: "side", title: "Side", type: "Dish", optional: true },
      { name: "servings", title: { en: "Servings", ar: "الحصص", fr: "Portions" }, type: "integer", default: 2 }],
    parameterSummary: { en: "Cook ${dish} for ${servings}", ar: "اطبخ ${dish} لـ ${servings}", fr: "Cuisiner ${dish} pour ${servings}" },
    shortcut: { phrases: [{ en: "Cook ${dish} in ${applicationName}", ar: "اطبخ ${dish} في ${applicationName}", fr: "Cuisiner ${dish} dans ${applicationName}" }],
      shortTitle: { en: "Cook", ar: "اطبخ", fr: "Cuisiner" }, systemImage: "frying.pan" } },
  { id: "openNote", title: "Open Note", returnsText: true, parameters: [{ name: "note", title: { en: "Note", ar: "ملاحظة", fr: "Note" }, type: "Note" }, { name: "other", title: "Other", type: "Note", optional: true }] },
];
const ENUMS = [{ id: "Dish", title: { en: "Dish", ar: "طبق", fr: "Plat" }, cases: [{ value: "pancakes", title: { en: "Pancakes", ar: "فطائر", fr: "Crêpes" } }, { value: "default", title: "House special" }] }];
const ENTITIES = [{ id: "Note", title: { en: "Note", ar: "ملاحظة", fr: "Note" } }];
const MACOS = { appIntents: INTENTS, appEnums: ENUMS, appEntities: ENTITIES };
const DECLARED = { intents: INTENTS, enums: ENUMS, entities: ENTITIES };

describe("macos.appIntents", () => {
  test("validates intents, parameters, enums, entities, translations and shortcuts", () => {
    expect(validateAppIntents(MACOS, LANGUAGES)).toEqual(DECLARED);
    expect(validateAppIntents({ appIntents: INTENTS.slice(0, 3) })).toEqual({ intents: INTENTS.slice(0, 3), enums: [], entities: [] });
    const recipe = (fields: object) => ({ appIntents: [{ id: "a", title: "T", ...fields }] });
    const dish = { appEnums: [{ id: "Dish", title: "Dish", cases: [{ value: "soup", title: "Soup" }] }] };
    const shortcut = (phrases: unknown[]) => ({ ...dish, ...recipe({ parameters: [{ name: "dish", title: "D", type: "Dish" }, { name: "n", title: "N", type: "integer" }], shortcut: { phrases, shortTitle: "S", systemImage: "star" } }) });
    const invalid: [unknown, RegExp, string[]?][] = [
      [{ appIntents: {} }, /must be a list/],
      [recipe({ id: "show-recipe" }), /unique id/],
      [{ appIntents: [{ id: "a", title: "T" }, { id: "a", title: "U" }] }, /unique id/],
      [{ appIntents: [{ id: "a" }] }, /a title must be text/],
      [recipe({ extra: 1 }), /unknown intent field extra/],
      [recipe({ returnsText: "yes" }), /returnsText must be a boolean/],
      [recipe({ parameters: [{ name: "Recipe", title: "R", type: "string" }] }), /unique names/],
      [recipe({ parameters: [{ name: "title", title: "R", type: "string" }] }), /other than/],
      [recipe({ parameters: [{ name: "r", title: "R", type: "string" }, { name: "r", title: "S", type: "string" }] }), /unique names/],
      [recipe({ parameters: [{ name: "r", title: "R", type: "date" }] }), /type must be one of string, number, integer, boolean, or an enum or entity id/],
      [recipe({ parameters: [{ name: "r", title: "R", type: "integer", default: 1.5 }] }), /default must be a value of its type/],
      [recipe({ parameters: [{ name: "r", title: "R", type: "string", default: 1 }] }), /default must be a value of its type/],
      [{ ...dish, ...recipe({ parameters: [{ name: "r", title: "R", type: "Dish", default: "stew" }] }) }, /a case value of Dish/],
      [{ appEntities: [{ id: "Note", title: "N" }], ...recipe({ parameters: [{ name: "r", title: "R", type: "Note", default: "n1" }] }) }, /r cannot have a default: it is an entity/],
      [{ appEnums: [{ id: "dish", title: "D", cases: [{ value: "a", title: "A" }] }] }, /starting with an uppercase letter/],
      [{ appEnums: [{ id: "Dish", title: "D", cases: [] }] }, /Dish needs cases/],
      [{ appEnums: [{ id: "Dish", title: "D", cases: [{ value: "rawValue", title: "A" }] }] }, /other than self, init, rawValue/],
      [{ appEnums: [{ id: "Dish", title: "D", cases: [{ value: "a", title: "A" }, { value: "a", title: "B" }] }] }, /unique values/],
      [{ appEnums: [{ id: "Dish", title: "D", cases: [{ value: "a", title: "A" }] }], appEntities: [{ id: "Dish", title: "D" }] }, /unique id/],
      [{ ...dish, appIntents: [] }, /no intent parameter uses Dish/],
      [recipe({ title: { en: "T" } }), /a title is translated, so the app needs localizations/],
      [recipe({ title: { en: "T", ar: "ت" } }), /a title needs text for each of the app's localizations, and only those: en, ar, fr/, LANGUAGES],
      [recipe({ title: { en: "T", ar: "ت", fr: "T", de: "T" } }), /and only those/, LANGUAGES],
      [recipe({ title: ["T"] }), /must be text, or text for each/],
      [recipe({ parameterSummary: "Show ${missing}" }), /uses \$\{missing\}, which is not a parameter of the intent/],
      [recipe({ parameters: [{ name: "n", title: "N", type: "integer" }], parameterSummary: { en: "${n} of them", ar: "منها", fr: "${n}" } }), /same placeholders in every language/, LANGUAGES],
      [recipe({ title: { en: "Same", ar: "أ", fr: "A" }, description: { en: "Same", ar: "ب", fr: "A" } }), /"Same" is translated in two different ways/, LANGUAGES],
      [shortcut(["Show a recipe"]), /must name the app once/],
      [shortcut(["${applicationName} ${applicationName}"]), /must name the app once/],
      [shortcut(["${dish} in ${applicationName}", "${dish} in ${applicationName}"]), /phrases must be unique/],
      [shortcut(["${n} in ${applicationName}"]), /uses \$\{n\}, which is not an enum parameter of the intent/],
      [shortcut([{ en: "${dish} in ${applicationName}", ar: "في ${applicationName}", fr: "${dish} ${applicationName}" }]), /same placeholders in every language/, LANGUAGES],
      [recipe({ shortcut: { phrases: ["In ${applicationName}"], shortTitle: "S" } }), /needs a systemImage/],
      [{ appIntents: Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, title: "T", shortcut: { phrases: ["In ${applicationName}"], shortTitle: "S", systemImage: "star" } })) }, /at most 10/],
    ];
    for (const [value, message, languages] of invalid) expect(() => validateAppIntents(value, languages), message.source).toThrow(message);
    // Desktop configuration validates them with the rest of macos, against its localizations.
    const config = { name: "Recipes", projectId: "recipes", version: "1.0.0", macos: { bundleIdentifier: "dev.example.recipes", appIntents: [{ id: "a" }] } };
    expect(() => toExpo(config)).toThrow(/a title must be text/);
    expect(() => toExpo({ ...config, macos: { ...config.macos, ...MACOS } })).toThrow(/Dish title is translated, so the app needs localizations/);
    const expo = toExpo({ ...config, localizations: LANGUAGES, macos: { ...config.macos, ...MACOS } }).expo;
    expect([expo.macos.appIntents, expo.macos.appEnums, expo.macos.appEntities]).toEqual([INTENTS, ENUMS, ENTITIES]);
  });

  test("lists the declarations for Info.plist in the development language, with defaults filled in", () => {
    expect(appIntentDeclarations(DECLARED, LANGUAGES)).toEqual([
      { id: "showRecipe", title: "Show Recipe", returnsText: true, parameters: [
        { name: "recipe", title: "Recipe", type: "string", optional: false }, { name: "servings", title: "Servings", type: "integer", optional: true }] },
      { id: "startTimer", title: "Start Timer", returnsText: false, parameters: [
        { name: "minutes", title: "Minutes", type: "number", optional: false, default: 2.5 }, { name: "loud", title: "Loud", type: "boolean", optional: true }] },
      { id: "ping", title: "Ping \\ \"pong\"\u0001\t\u007f", returnsText: false, parameters: [] },
      { id: "cook", title: "Cook", returnsText: false, parameters: [
        { name: "dish", title: "Dish", type: "enum", values: ["pancakes", "default"], optional: false, default: "default" },
        { name: "side", title: "Side", type: "enum", values: ["pancakes", "default"], optional: true },
        { name: "servings", title: "Servings", type: "integer", optional: false, default: 2 }] },
      { id: "openNote", title: "Open Note", returnsText: true, parameters: [
        { name: "note", title: "Note", type: "entity", entity: "Note", optional: false }, { name: "other", title: "Other", type: "entity", entity: "Note", optional: true }] },
    ]);
    expect(appEntityDeclarations(DECLARED, LANGUAGES)).toEqual([{ id: "Note", title: "Note" }]);
  });

  test("translated titles go to SparkAppIntents.xcstrings and translated phrases to AppShortcuts.xcstrings, keyed by the development language", () => {
    const strings = appIntentsStrings(DECLARED, LANGUAGES);
    const translations = (file: string) => Object.fromEntries(Object.entries(JSON.parse(strings[file]).strings as Record<string, { localizations: Record<string, { stringUnit: { value: string } }> }>)
      .map(([key, { localizations }]) => [key, Object.fromEntries(Object.entries(localizations).map(([language, { stringUnit }]) => [language, stringUnit.value]))]));
    expect(JSON.parse(strings["SparkAppIntents.xcstrings"])).toMatchObject({ sourceLanguage: "en", version: "1.0" });
    expect(translations("SparkAppIntents.xcstrings")).toEqual({
      Cook: { ar: "اطبخ", fr: "Cuisiner" }, "Cooks a dish": { ar: "يطبخ طبقًا", fr: "Cuisine un plat" }, Dish: { ar: "طبق", fr: "Plat" }, Pancakes: { ar: "فطائر", fr: "Crêpes" },
      Servings: { ar: "الحصص", fr: "Portions" }, Note: { ar: "ملاحظة", fr: "Note" },
      "Cook ${dish} for ${servings}": { ar: "اطبخ ${dish} لـ ${servings}", fr: "Cuisiner ${dish} pour ${servings}" },
    });
    expect(translations("AppShortcuts.xcstrings")).toEqual({ "Cook ${dish} in ${applicationName}": { ar: "اطبخ ${dish} في ${applicationName}", fr: "Cuisiner ${dish} dans ${applicationName}" } });
    // Nothing translated, no catalogs.
    expect(appIntentsStrings({ intents: INTENTS.slice(0, 3) })).toEqual({ "SparkAppIntents.xcstrings": undefined, "AppShortcuts.xcstrings": undefined });
  });

  test("the Kitchen Sink's intents are valid in its localizations, and its flows declare them as a build with them would", () => {
    const { localizations } = JSON.parse(readFileSync(path.join(root, "examples/kitchen-sink/desktop.config.json"), "utf8"));
    const declared = validateAppIntents({ appIntents: KS_APP_INTENTS, appEnums: KS_APP_ENUMS, appEntities: KS_APP_ENTITIES }, localizations);
    const [step] = parse(readFileSync(path.join(root, "e2e/subflows/declare-app-intents.yaml"), "utf8"));
    expect(step.simulateAppIntents).toEqual({ intents: appIntentDeclarations(declared, localizations), entities: appEntityDeclarations(declared, localizations) });
  });

  test("spark build fails an app whose product lacks the declared intents', enums' or entities' metadata", () => {
    const app = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-product-"));
    try {
      checkAppIntentsMetadata(app, undefined);
      checkAppIntentsMetadata(app, { appIntents: [] });
      expect(() => checkAppIntentsMetadata(app, MACOS)).toThrow("The build lacks App Intents metadata for SparkIntent_showRecipe, SparkIntent_startTimer, SparkIntent_ping, SparkIntent_cook, SparkIntent_openNote, SparkEnum_Dish, SparkEntity_Note in Contents/Resources/Metadata.appintents");
      mkdirSync(path.join(app, "Contents/Resources/Metadata.appintents"), { recursive: true });
      writeFileSync(path.join(app, "Contents/Resources/Metadata.appintents/extract.actionsdata"), JSON.stringify({ actions: { SparkIntent_showRecipe: {}, SparkIntent_ping: {}, SparkIntent_cook: {}, SparkIntent_openNote: {} }, enums: [{ identifier: "SparkEnum_Dish" }], entities: {} }));
      expect(() => checkAppIntentsMetadata(app, MACOS)).toThrow(/for SparkIntent_startTimer, SparkEntity_Note in/);
    } finally { rmSync(app, { recursive: true, force: true }); }
  });

  test("the plugin writes Info.plist, the app target's Swift and strings catalogs, and requires the JavaScript API in the build", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-plugin-"));
    try {
      mkdirSync(path.join(directory, "macos/Recipes"), { recursive: true });
      const added: { file: string; type: string; phase: string }[] = [];
      const project = { hasFile: (file: string) => added.some(entry => entry.file === file), pbxNativeTargetSection: () => ({ A1: { name: "\"Recipes-iOS\"" }, A1_comment: "Recipes-iOS", B2: { name: "Recipes" }, B2_comment: "Recipes" }) };
      const mods: Record<string, (mod: any) => any> = {};
      const options = (included?: string[]) => ({
        withInfoPlist: (config: object, mod: (mod: any) => any) => { mods.info = mod; return config; },
        withXcodeProject: (config: object, mod: (mod: any) => any) => { mods.project = mod; return config; },
        Xcodeproj: () => ({ getProjectName: () => "Recipes", addFileToGroupAndLink: ({ filepath, groupName, project: value, targetUuid, addFileToProject }: any) => {
          expect([groupName, targetUuid]).toEqual(["Recipes", "B2"]);
          const reference = { path: filepath, lastKnownFileType: "unknown" }, entry = { file: filepath, type: "", phase: "" };
          addFileToProject({ file: reference, project: { addToPbxFileReferenceSection: () => {}, addToPbxBuildFileSection: () => {},
            addToPbxSourcesBuildPhase: () => { entry.phase = "sources"; }, addToPbxResourcesBuildPhase: () => { entry.phase = "resources"; } } });
          added.push({ ...entry, type: reference.lastKnownFileType });
          return value;
        } }),
        selection: () => included,
      });
      // Nothing to generate without intents.
      withAppIntents({ macos: { bundleIdentifier: "a.b" } }, options());
      expect(mods).toEqual({});
      const config = { macos: MACOS, extra: { spark: { localizations: LANGUAGES } } };
      withAppIntents(config, options(["@legendapp/spark-app-intents"]));
      expect(mods.info!({ modResults: { CFBundleName: "Recipes" } }).modResults).toEqual({ CFBundleName: "Recipes", SparkAppIntents: appIntentDeclarations(DECLARED, LANGUAGES), SparkAppEntities: [{ id: "Note", title: "Note" }] });
      const request = { modRequest: { projectRoot: directory, platformProjectRoot: path.join(directory, "macos") }, modResults: project };
      mods.project!(request);
      mods.project!(request);
      expect(added).toEqual([{ file: "SparkAppIntents.swift", type: "unknown", phase: "sources" },
        { file: "SparkAppIntents.xcstrings", type: "text.json.xcstrings", phase: "resources" }, { file: "AppShortcuts.xcstrings", type: "text.json.xcstrings", phase: "resources" }]);
      expect(readFileSync(path.join(directory, "macos/Recipes/SparkAppIntents.swift"), "utf8")).toBe(appIntentsSwift(DECLARED, LANGUAGES));
      for (const file of ["SparkAppIntents.xcstrings", "AppShortcuts.xcstrings"]) expect(readFileSync(path.join(directory, "macos/Recipes", file), "utf8")).toBe(appIntentsStrings(DECLARED, LANGUAGES)[file]);
      withAppIntents(config, options(["@legendapp/spark-sharing"]));
      expect(() => mods.project!(request)).toThrow(/never imports @legendapp\/spark\/app-intents/);
      expect(() => withAppIntents({ macos: { appIntents: [{ id: "a" }] } }, options())).toThrow(/a title must be text/);
      expect(() => withAppIntents({ macos: { appEnums: ENUMS }, extra: { spark: { localizations: LANGUAGES } } }, options())).toThrow(/no intent parameter uses Dish/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  // What Xcode's "Extract App Intents Metadata" and "Compile XCStrings" steps do for the app target, run directly: the
  // generated Swift is compiled against the pod's public header with its constant values extracted,
  // appintentsmetadataprocessor writes Metadata.appintents, which the build puts in Contents/Resources, and
  // xcstringstool compiles the catalogs into each language's .lproj. No app is built or registered.
  test.skipIf(process.platform !== "darwin")("the generated Swift compiles against the pod's module, its App Intents metadata lists the intents, parameters, enums, entities and App Shortcuts, and the compiled catalogs translate every title and phrase", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-build-"));
    try {
      const modules = path.join(directory, "modules");
      mkdirSync(modules);
      copyFileSync(path.join(root, "packages/app-intents/macos/SparkAppIntentsBridge.h"), path.join(modules, "SparkAppIntentsBridge.h"));
      writeFileSync(path.join(modules, "module.modulemap"), "module RNDesktopAppIntents {\n  header \"SparkAppIntentsBridge.h\"\n  export *\n}\n");
      const source = path.join(directory, "SparkAppIntents.swift");
      const swift = appIntentsSwift(DECLARED, LANGUAGES);
      writeFileSync(source, swift);
      // Control characters become \u{XX} escapes, so every title compiles as one literal.
      expect(swift).toContain(String.raw`static let title = LocalizedStringResource("Ping \\ \"pong\"\u{01}\u{09}\u{7F}", table: "SparkAppIntents")`);
      expect(swift).toContain(String.raw`IntentDescription(LocalizedStringResource("Shows a \"recipe\"\u{0A}with its steps", table: "SparkAppIntents"))`);
      // The protocols Xcode asks the compiler to gather constant values for (Xcode's <target>_const_extract_protocols.json).
      writeFileSync(path.join(directory, "protocols.json"), JSON.stringify(["AppIntent", "EntityQuery", "AppEntity", "TransientEntity", "AppEnum", "AppShortcutProviding", "AppShortcutsProvider", "AnyResolverProviding", "AppIntentsPackage", "DynamicOptionsProvider", "_IntentValueRepresentable", "_AssistantIntentsProvider", "_GenerativeFunctionExtractable", "IntentValueQuery", "Resolver", "AppExtension", "ExtensionPointDefining"]));
      const sdk = (await runOk("xcrun", ["--sdk", "macosx", "--show-sdk-path"])).trim();
      const target = `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`;
      const values = path.join(directory, "Recipes.swiftconstvalues");
      await runOk("xcrun", ["swiftc", "-c", source, "-module-name", "Recipes", "-parse-as-library", "-sdk", sdk, "-target", target, "-I", modules,
        "-emit-const-values-path", values, "-Xfrontend", "-const-gather-protocols-file", "-Xfrontend", path.join(directory, "protocols.json"), "-o", path.join(directory, "Recipes.o")], { timeout: 120000 });
      for (const [name, contents] of [["sources", source], ["values", values], ["none", ""]]) writeFileSync(path.join(directory, name), contents);
      const swiftc = (await runOk("xcrun", ["--find", "swiftc"])).trim();
      const xcode = (await runOk("xcodebuild", ["-version"])).match(/Build version (\S+)/)![1]!;
      const app = path.join(directory, "Recipes.app");
      const resources = path.join(app, "Contents/Resources");
      // The phrases are translated (AppShortcuts.xcstrings), so Xcode runs the processor without --no-app-shortcuts-localization.
      await runOk("xcrun", ["appintentsmetadataprocessor", "--toolchain-dir", path.resolve(swiftc, "../../.."), "--module-name", "Recipes", "--sdk-root", sdk,
        "--xcode-version", xcode, "--platform-family", "macOS", "--deployment-target", "14.0", "--bundle-identifier", "dev.example.recipes", "--output", resources,
        "--target-triple", target, "--source-file-list", path.join(directory, "sources"), "--swift-const-vals-list", path.join(directory, "values"),
        "--metadata-file-list", path.join(directory, "none"), "--static-metadata-file-list", path.join(directory, "none"),
        "--compile-time-extraction", "--deployment-aware-processing"], { timeout: 120000 });
      // spark build's check of the product passes for these declarations, and fails for one the metadata lacks.
      checkAppIntentsMetadata(app, MACOS);
      expect(() => checkAppIntentsMetadata(app, { ...MACOS, appIntents: [...INTENTS, { id: "missing", title: "Missing" }] })).toThrow(/lacks App Intents metadata for SparkIntent_missing/);
      const metadata = JSON.parse(readFileSync(path.join(resources, "Metadata.appintents/extract.actionsdata"), "utf8"));
      expect(Object.keys(metadata.actions).sort()).toEqual(["SparkIntent_cook", "SparkIntent_openNote", "SparkIntent_ping", "SparkIntent_showRecipe", "SparkIntent_startTimer"]);
      const key = (value: string) => ({ key: value, table: "SparkAppIntents" });
      const recipe = metadata.actions.SparkIntent_showRecipe;
      expect(recipe).toMatchObject({ title: key("Show Recipe"), descriptionMetadata: { descriptionText: key("Shows a \"recipe\"\nwith its steps") }, openAppWhenRun: true });
      type Parameter = { name: string; isOptional: boolean; title: { key: string }; typeSpecificMetadata: unknown[]; valueType: object };
      expect(recipe.parameters.map((parameter: Parameter) => [parameter.name, parameter.isOptional, parameter.title.key])).toEqual([["recipe", false, "Recipe"], ["servings", true, "Servings"]]);
      expect(metadata.actions.SparkIntent_startTimer).toMatchObject({ title: key("Start Timer"), openAppWhenRun: false });
      expect(metadata.actions.SparkIntent_startTimer.parameters[0].typeSpecificMetadata).toEqual(["LNValueTypeSpecificMetadataKeyDefaultValue", { double: { wrapper: 2.5 } }]);
      expect(metadata.actions.SparkIntent_ping.title.key).toBe("Ping \\ \"pong\"\u0001\t\u007f");
      // An enum parameter with its default, a summary naming parameters, and entity parameters.
      const cook = metadata.actions.SparkIntent_cook;
      expect(cook.parameters.map((parameter: Parameter) => [parameter.name, parameter.isOptional, parameter.valueType, parameter.typeSpecificMetadata])).toEqual([
        ["dish", false, { linkEnumeration: { wrapper: { identifier: "SparkEnum_Dish" } } }, ["LNValueTypeSpecificMetadataKeyDefaultValue", { string: { wrapper: "default" } }]],
        ["side", true, { linkEnumeration: { wrapper: { identifier: "SparkEnum_Dish" } } }, []],
        ["servings", false, { primitive: { wrapper: { typeIdentifier: 2 } } }, ["LNValueTypeSpecificMetadataKeyDefaultValue", { int: { wrapper: 2 } }]]]);
      expect(cook.actionConfiguration.actionSummary.wrapper).toMatchObject({ summaryString: { formatString: "Cook ${dish} for ${servings}", parameterIdentifiers: ["dish", "servings"] }, table: "SparkAppIntents" });
      expect(metadata.actions.SparkIntent_openNote.parameters.map((parameter: Parameter) => [parameter.name, parameter.isOptional, parameter.valueType]))
        .toEqual([["note", false, { entity: { wrapper: { typeName: "SparkEntity_Note" } } }], ["other", true, { entity: { wrapper: { typeName: "SparkEntity_Note" } } }]]);
      expect(metadata.enums).toMatchObject([{ identifier: "SparkEnum_Dish", displayTypeName: key("Dish"), cases: [
        { identifier: "pancakes", displayRepresentation: { title: key("Pancakes") } }, { identifier: "default", displayRepresentation: { title: key("House special") } }] }]);
      expect(metadata.entities.SparkEntity_Note).toMatchObject({ displayTypeName: key("Note"), defaultQueryIdentifier: "Recipes.SparkQuery_Note" });
      expect(metadata.queries.SparkQuery_Note).toMatchObject({ entityType: "SparkEntity_Note" });
      expect(metadata.autoShortcuts).toMatchObject([
        { actionIdentifier: "SparkIntent_showRecipe", systemImageName: "fork.knife", shortTitle: key("Show Recipe"), phraseTemplates: [{ key: "Show a recipe in ${applicationName}" }, { key: "${applicationName} recipe" }] },
        { actionIdentifier: "SparkIntent_cook", systemImageName: "frying.pan", shortTitle: key("Cook"), phraseTemplates: [{ key: "Cook ${dish} in ${applicationName}" }] },
      ]);
      // Every key the metadata looks up in the SparkAppIntents table (and every phrase) is in each language's compiled strings.
      const strings = appIntentsStrings(DECLARED, LANGUAGES);
      for (const file of Object.keys(strings)) writeFileSync(path.join(directory, file), strings[file]);
      for (const file of Object.keys(strings)) await runOk("xcrun", ["xcstringstool", "compile", path.join(directory, file), "--output-directory", resources], { timeout: 60000 });
      const compiled = async (language: string, table: string) => JSON.parse(await runOk("plutil", ["-convert", "json", "-o", "-", path.join(resources, `${language}.lproj/${table}.strings`)]));
      // Titles are { key, table }; summaries { formatString } in an actionSummary with the table.
      const tableKeys = [...JSON.stringify(metadata).matchAll(/"(?:key|formatString)":"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1]}"`));
      expect(JSON.stringify(metadata).match(/"table":"[^"]*"/g)!.every(table => table === '"table":"SparkAppIntents"')).toBe(true);
      const translated = Object.keys(JSON.parse(strings["SparkAppIntents.xcstrings"]).strings);
      expect(translated.filter(item => !tableKeys.includes(item))).toEqual([]);
      for (const language of LANGUAGES) {
        expect(Object.keys(await compiled(language, "SparkAppIntents")).sort(), language).toEqual([...translated].sort());
        const phrase = { en: "Cook ${dish} in ${applicationName}", ar: "اطبخ ${dish} في ${applicationName}", fr: "Cuisiner ${dish} dans ${applicationName}" }[language];
        expect(await compiled(language, "AppShortcuts"), language).toEqual({ "Cook ${dish} in ${applicationName}": phrase });
      }
      expect(await compiled("ar", "SparkAppIntents")).toMatchObject({ Cook: "اطبخ", Dish: "طبق", "Cook ${dish} for ${servings}": "اطبخ ${dish} لـ ${servings}", Note: "ملاحظة" });
      expect(await compiled("fr", "SparkAppIntents")).toMatchObject({ Pancakes: "Crêpes", Servings: "Portions" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 240000);
});
