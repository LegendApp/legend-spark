import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { KS_APP_INTENTS } from "../examples/kitchen-sink/screens/system-integration/app-intents-config.ts";
import { runOk } from "./subprocess.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const { validateAppIntents, appIntentDeclarations, appIntentsSwift, withAppIntents, checkAppIntentsMetadata } = require("../packages/config-plugin/app-intents.cjs");
const { toExpo } = require("../packages/config-plugin/config.cjs");

const INTENTS = [
  { id: "showRecipe", title: "Show Recipe", description: "Shows a \"recipe\"\nwith its steps", returnsText: true, openApp: true,
    parameters: [{ name: "recipe", title: "Recipe", type: "string" }, { name: "servings", title: "Servings", type: "integer", optional: true }],
    shortcut: { phrases: ["Show a recipe in ${applicationName}", "${applicationName} recipe"], shortTitle: "Show Recipe", systemImage: "fork.knife" } },
  { id: "startTimer", title: "Start Timer", parameters: [{ name: "minutes", title: "Minutes", type: "number" }, { name: "loud", title: "Loud", type: "boolean", optional: true }] },
  { id: "ping", title: "Ping \\ \"pong\"" },
];

describe("macos.appIntents", () => {
  test("validates ids, parameters and shortcuts", () => {
    expect(validateAppIntents(INTENTS)).toBe(INTENTS);
    const invalid: [unknown, RegExp][] = [
      [{}, /must be a list/],
      [[{ id: "show-recipe", title: "T" }], /unique id/],
      [[{ id: "a", title: "T" }, { id: "a", title: "U" }], /unique id/],
      [[{ id: "a" }], /needs a title/],
      [[{ id: "a", title: "T", extra: 1 }], /unknown intent field extra/],
      [[{ id: "a", title: "T", returnsText: "yes" }], /returnsText must be a boolean/],
      [[{ id: "a", title: "T", parameters: [{ name: "Recipe", title: "R", type: "string" }] }], /unique names/],
      [[{ id: "a", title: "T", parameters: [{ name: "title", title: "R", type: "string" }] }], /other than/],
      [[{ id: "a", title: "T", parameters: [{ name: "r", title: "R", type: "string" }, { name: "r", title: "S", type: "string" }] }], /unique names/],
      [[{ id: "a", title: "T", parameters: [{ name: "r", title: "R", type: "date" }] }], /type must be one of string, number, integer, boolean/],
      [[{ id: "a", title: "T", shortcut: { phrases: ["Show a recipe"], shortTitle: "S", systemImage: "star" } }], /name the app once/],
      [[{ id: "a", title: "T", shortcut: { phrases: ["${applicationName} ${applicationName}"], shortTitle: "S", systemImage: "star" } }], /name the app once/],
      [[{ id: "a", title: "T", shortcut: { phrases: ["In ${applicationName}"], shortTitle: "S" } }], /shortTitle and a systemImage/],
      [Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, title: "T", shortcut: { phrases: ["In ${applicationName}"], shortTitle: "S", systemImage: "star" } })), /at most 10/],
    ];
    for (const [value, message] of invalid) expect(() => validateAppIntents(value), message.source).toThrow(message);
    // Desktop configuration validates it with the rest of macos.
    const config = { name: "Recipes", projectId: "recipes", version: "1.0.0", macos: { bundleIdentifier: "dev.example.recipes", appIntents: [{ id: "a" }] } };
    expect(() => toExpo(config)).toThrow(/a needs a title/);
    expect(toExpo({ ...config, macos: { ...config.macos, appIntents: INTENTS } }).expo.macos.appIntents).toEqual(INTENTS);
  });

  test("lists the declarations for Info.plist with defaults filled in", () => {
    expect(appIntentDeclarations(INTENTS)).toEqual([
      { id: "showRecipe", title: "Show Recipe", returnsText: true, parameters: [
        { name: "recipe", title: "Recipe", type: "string", optional: false }, { name: "servings", title: "Servings", type: "integer", optional: true }] },
      { id: "startTimer", title: "Start Timer", returnsText: false, parameters: [
        { name: "minutes", title: "Minutes", type: "number", optional: false }, { name: "loud", title: "Loud", type: "boolean", optional: true }] },
      { id: "ping", title: "Ping \\ \"pong\"", returnsText: false, parameters: [] },
    ]);
  });

  test("the Kitchen Sink's intents are valid, and its flows declare them as a build with them would", () => {
    expect(validateAppIntents(KS_APP_INTENTS)).toBe(KS_APP_INTENTS);
    const [step] = parse(readFileSync(path.join(root, "e2e/subflows/declare-app-intents.yaml"), "utf8"));
    expect(step.simulateAppIntents.intents).toEqual(appIntentDeclarations(KS_APP_INTENTS));
  });

  test("spark build fails an app whose product lacks the declared intents' metadata", () => {
    const app = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-product-"));
    try {
      checkAppIntentsMetadata(app, undefined);
      checkAppIntentsMetadata(app, []);
      expect(() => checkAppIntentsMetadata(app, INTENTS)).toThrow("The build lacks App Intents metadata for SparkIntent_showRecipe, SparkIntent_startTimer, SparkIntent_ping in Contents/Resources/Metadata.appintents");
      mkdirSync(path.join(app, "Contents/Resources/Metadata.appintents"), { recursive: true });
      writeFileSync(path.join(app, "Contents/Resources/Metadata.appintents/extract.actionsdata"), JSON.stringify({ actions: { SparkIntent_showRecipe: {}, SparkIntent_ping: {} } }));
      expect(() => checkAppIntentsMetadata(app, INTENTS)).toThrow(/for SparkIntent_startTimer in/);
    } finally { rmSync(app, { recursive: true, force: true }); }
  });

  test("the plugin writes Info.plist and the app target's Swift, and requires the JavaScript API in the build", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-plugin-"));
    try {
      mkdirSync(path.join(directory, "macos/Recipes"), { recursive: true });
      const added: string[] = [];
      const project = { hasFile: (file: string) => added.includes(file), pbxNativeTargetSection: () => ({ A1: { name: "\"Recipes-iOS\"" }, A1_comment: "Recipes-iOS", B2: { name: "Recipes" }, B2_comment: "Recipes" }) };
      const mods: Record<string, (mod: any) => any> = {};
      const options = (included?: string[]) => ({
        withInfoPlist: (config: object, mod: (mod: any) => any) => { mods.info = mod; return config; },
        withXcodeProject: (config: object, mod: (mod: any) => any) => { mods.project = mod; return config; },
        Xcodeproj: () => ({ getProjectName: () => "Recipes", addBuildSourceFileToGroup: ({ filepath, groupName, project: value, targetUuid }: { filepath: string; groupName: string; project: unknown; targetUuid: string }) => { added.push(filepath); expect([groupName, targetUuid]).toEqual(["Recipes", "B2"]); return value; } }),
        selection: () => included,
      });
      // Nothing to generate without intents.
      withAppIntents({ macos: { bundleIdentifier: "a.b" } }, options());
      expect(mods).toEqual({});
      withAppIntents({ macos: { appIntents: INTENTS } }, options(["@legendapp/spark-app-intents"]));
      expect(mods.info!({ modResults: { CFBundleName: "Recipes" } }).modResults).toEqual({ CFBundleName: "Recipes", SparkAppIntents: appIntentDeclarations(INTENTS) });
      const request = { modRequest: { projectRoot: directory, platformProjectRoot: path.join(directory, "macos") }, modResults: project };
      mods.project!(request);
      mods.project!(request);
      expect(added).toEqual(["SparkAppIntents.swift"]);
      expect(readFileSync(path.join(directory, "macos/Recipes/SparkAppIntents.swift"), "utf8")).toBe(appIntentsSwift(INTENTS));
      withAppIntents({ macos: { appIntents: INTENTS } }, options(["@legendapp/spark-sharing"]));
      expect(() => mods.project!(request)).toThrow(/never imports @legendapp\/spark\/app-intents/);
      expect(() => withAppIntents({ macos: { appIntents: [{ id: "a" }] } }, options())).toThrow(/needs a title/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  // What Xcode's "Extract App Intents Metadata" step does for the app target, run directly: the generated Swift is
  // compiled against the pod's public header with its constant values extracted, and appintentsmetadataprocessor
  // writes Metadata.appintents, which the build puts in Contents/Resources. No app is built or registered.
  test.skipIf(process.platform !== "darwin")("the generated Swift compiles against the pod's module and its App Intents metadata lists the intents, parameters and App Shortcuts", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "spark-app-intents-build-"));
    try {
      const modules = path.join(directory, "modules");
      mkdirSync(modules);
      copyFileSync(path.join(root, "packages/app-intents/macos/SparkAppIntentsBridge.h"), path.join(modules, "SparkAppIntentsBridge.h"));
      writeFileSync(path.join(modules, "module.modulemap"), "module RNDesktopAppIntents {\n  header \"SparkAppIntentsBridge.h\"\n  export *\n}\n");
      const source = path.join(directory, "SparkAppIntents.swift");
      writeFileSync(source, appIntentsSwift(INTENTS));
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
      await runOk("xcrun", ["appintentsmetadataprocessor", "--toolchain-dir", path.resolve(swiftc, "../../.."), "--module-name", "Recipes", "--sdk-root", sdk,
        "--xcode-version", xcode, "--platform-family", "macOS", "--deployment-target", "14.0", "--bundle-identifier", "dev.example.recipes", "--output", resources,
        "--target-triple", target, "--source-file-list", path.join(directory, "sources"), "--swift-const-vals-list", path.join(directory, "values"),
        "--metadata-file-list", path.join(directory, "none"), "--static-metadata-file-list", path.join(directory, "none"),
        "--compile-time-extraction", "--deployment-aware-processing", "--no-app-shortcuts-localization"], { timeout: 120000 });
      // spark build's check of the product passes for these intents, and fails for one the metadata lacks.
      checkAppIntentsMetadata(app, INTENTS);
      expect(() => checkAppIntentsMetadata(app, [...INTENTS, { id: "missing", title: "Missing" }])).toThrow(/lacks App Intents metadata for SparkIntent_missing/);
      const metadata = JSON.parse(readFileSync(path.join(resources, "Metadata.appintents/extract.actionsdata"), "utf8"));
      expect(Object.keys(metadata.actions).sort()).toEqual(["SparkIntent_ping", "SparkIntent_showRecipe", "SparkIntent_startTimer"]);
      const recipe = metadata.actions.SparkIntent_showRecipe;
      expect(recipe).toMatchObject({ title: { key: "Show Recipe" }, descriptionMetadata: { descriptionText: { key: "Shows a \"recipe\"\nwith its steps" } }, openAppWhenRun: true });
      expect(recipe.parameters.map((parameter: { name: string; isOptional: boolean; title: { key: string } }) => [parameter.name, parameter.isOptional, parameter.title.key]))
        .toEqual([["recipe", false, "Recipe"], ["servings", true, "Servings"]]);
      expect(metadata.actions.SparkIntent_startTimer).toMatchObject({ title: { key: "Start Timer" }, openAppWhenRun: false });
      expect(metadata.actions.SparkIntent_ping.title.key).toBe("Ping \\ \"pong\"");
      expect(metadata.autoShortcuts).toMatchObject([{ actionIdentifier: "SparkIntent_showRecipe", systemImageName: "fork.knife", shortTitle: { key: "Show Recipe" },
        phraseTemplates: [{ key: "Show a recipe in ${applicationName}" }, { key: "${applicationName} recipe" }] }]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 240000);
});
