import { afterAll, beforeAll, expect, test } from "vitest";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

const require = createRequire(import.meta.url);
const { replacements, patchTextServicesSource, installTextServicesPatch } = require("../packages/config-plugin/text-services.cjs") as {
  replacements: Record<string, [string, string][]>;
  patchTextServicesSource(file: string, source: string): string;
  installTextServicesPatch(root: string): void;
};
const rnRoot = path.dirname(require.resolve("react-native-macos/package.json"));
const root = path.resolve(import.meta.dirname, "..");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine = Object.fromEntries(Object.entries(replacements).map(([file, pairs]) =>
  [file, pairs.reduce((source, [before, after]) => source.replace(after, before), readFileSync(path.join(rnRoot, file), "utf8"))]));
const patched = Object.fromEntries(Object.entries(pristine).map(([file, source]) => [file, patchTextServicesSource(file, source)]));
const componentView = "React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm";

test("text services patch applies to clean TextInput sources, is idempotent and rejects changed upstream code", () => {
  for (const file of Object.keys(replacements)) {
    expect(patched[file], file).not.toBe(pristine[file]);
    expect(patchTextServicesSource(file, patched[file]!)).toBe(patched[file]);
  }
  expect(() => patchTextServicesSource("Libraries/Text/TextInput/Multiline/RCTUITextView.mm", pristine["Libraries/Text/TextInput/Multiline/RCTUITextView.mm"]!.replace("self.allowsUndo = YES;", "self.allowsUndo = NO;"))).toThrow("source changed");
  expect(() => patchTextServicesSource("Libraries/Other.mm", "")).toThrow("Unknown text services patch target");
  // The prop reaches native through the view config, the C++ trait and its conversion.
  expect(patched["Libraries/Components/TextInput/RCTTextInputViewConfig.js"]).toContain("writingToolsBehavior: true");
  expect(patched["ReactCommon/react/renderer/components/textinput/platform/ios/react/renderer/components/iostextinput/primitives.h"]).toContain('std::string writingToolsBehavior{"default"};');
  expect(patched["ReactCommon/react/renderer/components/textinput/platform/ios/react/renderer/components/iostextinput/propsConversions.h"]).toContain('"writingToolsBehavior",');
  // Applied on prop changes and backed-view swaps, while a single-line field edits, and reset when it stops.
  const view = patched[componentView]!;
  expect(view).toContain("newTextInputProps.multiline != oldTextInputProps.multiline ||");
  expect(view.slice(view.indexOf("- (void)textInputDidBeginEditing"))).toMatch(/^- \(void\)textInputDidBeginEditing\n\{\n#if TARGET_OS_OSX[^\n]*\n  RCTSparkApplyWritingToolsBehavior/);
  expect(view.slice(view.indexOf("- (void)textInputDidEndEditing"))).toMatch(/^- \(void\)textInputDidEndEditing\n\{\n#if TARGET_OS_OSX[^\n]*\n  RCTSparkResetFieldEditorWritingTools\(_backedTextInputView.responder\);/);
});

test("text services patch install checks the version, validates every file first and preserves cache hardlinks", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "spark-text-services-"));
  try {
    const dependency = path.join(fixture, "node_modules/react-native-macos");
    mkdirSync(dependency, { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.81.7" }));
    const caches: Record<string, string> = {};
    for (const [file, source] of Object.entries(pristine)) {
      const installed = path.join(dependency, file), cache = path.join(fixture, `cache-${path.basename(file)}`);
      mkdirSync(path.dirname(installed), { recursive: true });
      writeFileSync(cache, source); linkSync(cache, installed); caches[file] = cache;
    }
    // One changed upstream file leaves every file untouched.
    const view = path.join(dependency, componentView);
    rmSync(view); writeFileSync(view, pristine[componentView]!.replace("- (void)textInputDidEndEditing\n{\n", "- (void)textInputDidEndEditing {\n"));
    expect(() => installTextServicesPatch(fixture)).toThrow("source changed");
    for (const [file, source] of Object.entries(pristine)) if (file !== componentView) expect(readFileSync(path.join(dependency, file), "utf8")).toBe(source);
    rmSync(view); linkSync(caches[componentView]!, view);
    installTextServicesPatch(fixture);
    for (const [file, cache] of Object.entries(caches)) {
      expect(readFileSync(cache, "utf8")).toBe(pristine[file]);
      expect(readFileSync(path.join(dependency, file), "utf8")).toBe(patched[file]);
    }
    const inode = statSync(view).ino; installTextServicesPatch(fixture);
    expect(statSync(view).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installTextServicesPatch(fixture)).toThrow("requires react-native-macos@0.81.7");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-text-services-test-"));
  const view = patched[componentView]!;
  const helpers = view.slice(view.indexOf("static BOOL RCTSparkIsWritingToolsBehavior"), view.indexOf("#endif // macOS]", view.indexOf("static void RCTSparkApplyWritingToolsBehavior")));
  const [, init] = replacements["Libraries/Text/TextInput/Multiline/RCTUITextView.mm"]![0]!;
  const sparkTextInput = ["RNSparkLayoutDirection.h", "RNSparkTextInput.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
  const input = path.join(directory, "TextServices.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "text-services.native.mm"), "utf8")
    .replace("// ACTUAL_SPARK_TEXT_INPUT", sparkTextInput)
    .replace("// ACTUAL_PATCHED_INIT", init)
    .replace("// ACTUAL_WRITING_TOOLS_HELPERS", helpers));
  const services = path.join(root, "packages/ui/macos/text-services");
  await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-Werror=unguarded-availability-new", "-I", services, "-framework", "AppKit", input, path.join(services, "SparkTextServices.mm"), "-o", executable], { timeout: 60000 });
}, 90000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["find", "find-bar", "look-up", "services", "spark-text-input-services", "writing-tools"])("AppKit text services: %s", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
