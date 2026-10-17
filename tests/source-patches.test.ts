import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { patchTemplateRenameSource } = require("../packages/config-plugin/source-patches.cjs");
const template = path.join(path.dirname(require.resolve("expo-desktop/package.json")), "build/common/expo/template.js");

test("Expo Desktop's template renaming leaves app.json files in node_modules alone", async () => {
  const source = readFileSync(template, "utf8");
  const patched = patchTemplateRenameSource(source);
  expect(patchTemplateRenameSource(patched)).toBe(patched);
  expect(() => patchTemplateRenameSource("changed upstream")).toThrow("template renaming changed");
  // The patched module, next to the original so its imports resolve, against a project with a dependency's app.json.
  const module = path.join(path.dirname(template), `template.spark-test-${process.pid}.js`);
  const project = mkdtempSync(path.join(os.tmpdir(), "spark-template-rename-"));
  try {
    writeFileSync(module, patched);
    for (const file of ["app.json", "macos/Podfile", "node_modules/dependency/app.json"]) {
      mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      writeFileSync(path.join(project, file), "HelloWorld");
    }
    const { getTemplateFilesToRenameAsync } = await import(pathToFileURL(module).href);
    expect((await getTemplateFilesToRenameAsync({ cwd: project })).sort()).toEqual(["app.json", "macos/Podfile"]);
  } finally {
    rmSync(module, { force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
