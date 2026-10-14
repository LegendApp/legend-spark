import { afterEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMigrationContext, type FileChange, type ManualStep } from "../packages/cli/src/migration-helpers.cjs";
import { applyMigrationPlan, migrateProject, migrations, planMigrations, type Migration } from "../packages/cli/src/migrations.cjs";

const roots: string[] = [];
const original = [...migrations];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-migration-helpers-"));
  roots.push(root);
  const changes = new Map<string, FileChange>();
  const manualSteps: ManualStep[] = [];
  const context = createMigrationContext(root, "0.0.1-next.5", changes, manualSteps);
  const write = (file: string, value: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), value); };
  return { root, context, changes, manualSteps, write };
}
afterEach(() => {
  migrations.splice(0, migrations.length, ...original);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("JSON edits retain formatting, unrelated values and original bytes across chained edits", () => {
  const { root, context, changes, write } = fixture();
  const before = '{\r\n\t"scripts": { "check": "old" },\r\n\t"custom": true\r\n}\r\n';
  write("package.json", before);
  context.editJson<{ scripts: Record<string, string> }>("package.json", pkg => { pkg.scripts.check = "new"; });
  context.editJson("package.json", pkg => { pkg.main = "src/index.ts"; });
  expect(changes.get("package.json")?.before).toBe(before);
  expect(context.readFile("package.json")).toContain('\r\n\t"main": "src/index.ts"');
  expect(JSON.parse(context.readFile("package.json")!).custom).toBe(true);
  expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  context.writeFile("new.txt", "first"); context.writeFile("new.txt", "second");
  expect(changes.get("new.txt")).toEqual({ file: "new.txt", before: null, after: "second" });
  context.editJson("optional.json", () => { throw new Error("not called"); });
  const count = changes.size;
  context.editJson("package.json", () => {});
  expect(changes.size).toBe(count);
});

test("invalid JSON, file collisions and customized templates produce precise manual steps", () => {
  const { context, changes, manualSteps, write } = fixture();
  write("app.json", "{bad json}");
  write("old.ts", "old"); write("new.ts", "custom");
  write("metro.config.js", "custom config");
  context.editJson("app.json", () => {});
  write("scalar.json", "null"); context.editJson("scalar.json", () => {});
  context.renameFile("old.ts", "new.ts");
  context.updateTemplate("metro.config.js", "old config", "new config");
  expect(changes.size).toBe(0);
  expect(manualSteps.map(step => step.message).join("\n")).toMatch(/app.json.*not valid JSON/);
  expect(manualSteps.map(step => step.message).join("\n")).toContain("destination already exists");
  expect(manualSteps.map(step => step.message).join("\n")).toContain("customized");
  expect(manualSteps.map(step => step.message).join("\n")).toContain("expected a JSON object");
  expect(manualSteps.every(step => step.notes.endsWith("UPGRADING.md#001-next5"))).toBe(true);
  context.updateTemplate("missing.js", "old", "new");
  write("managed.js", "old"); context.updateTemplate("managed.js", "old", "new");
  expect(context.readFile("missing.js")).toBe("new");
  expect(context.readFile("managed.js")).toBe("new");
});

test("imports and reexports retain local names, formatting, types and comments", () => {
  const { context, manualSteps, write } = fixture();
  const source = `// import { oldAPI } from 'old-module'
import { oldAPI, oldAPI as local, type OldType } from 'old-module';
export { oldAPI } from "old-module";
const value = oldAPI();
`;
  write("src/App.tsx", source);
  context.replaceImport("old-module", "new-module", { oldAPI: "newAPI", OldType: "NewType" });
  expect(context.readFile("src/App.tsx")).toBe(`// import { oldAPI } from 'old-module'
import { newAPI as oldAPI, newAPI as local, type NewType as OldType } from 'new-module';
export { newAPI as oldAPI } from "new-module";
const value = oldAPI();
`);
  expect(manualSteps).toEqual([]);
  context.replaceImport("old-module", "new-module", { oldAPI: "newAPI" });
  expect(manualSteps).toEqual([]);
});

test("path-only codemods handle require/dynamic imports; unsupported API use is manual", () => {
  const { context, manualSteps, write } = fixture();
  write("config.cjs", `const old = require('old-module');\nconst lazy = import("old-module");\n`);
  context.replaceImport("old-module", "new-module");
  expect(context.readFile("config.cjs")).toBe(`const old = require('new-module');\nconst lazy = import("new-module");\n`);
  write("api.ts", `import * as api from 'old-api';\nconst api2 = require('old-api');\nconst literal = 'old-api';\n`);
  context.replaceImport("old-api", "new-api", { oldAPI: "newAPI" });
  expect(context.readFile("api.ts")).toContain("from 'old-api'");
  expect(manualSteps).toHaveLength(3);
  write("bad.ts", `import { from 'old-api';`);
  context.replaceImport("old-api", "new-api");
  expect(manualSteps.some(step => step.message.includes("could not be parsed"))).toBe(true);
});

test("helpers reject escaping paths and symlinks without touching outside files", () => {
  const { root, context, write } = fixture();
  write("outside.txt", "keep");
  symlinkSync(path.join(root, "outside.txt"), path.join(root, "linked.txt"));
  expect(() => context.writeFile("../outside.txt", "changed")).toThrow("stay in the app");
  expect(() => context.editJson("linked.txt", () => {})).toThrow("symlink");
  expect(readFileSync(path.join(root, "outside.txt"), "utf8")).toBe("keep");
});

test("codemods leave locally bound require calls and mixed default API imports for review", () => {
  const { context, manualSteps, write } = fixture();
  write("shadowed.js", `function custom(require) { return require('old-module'); }\n`);
  context.replaceImport("old-module", "new-module");
  expect(context.readFile("shadowed.js")).toContain("'old-module'");
  expect(manualSteps[0].message).toContain("locally bound");
  write("default.ts", `import api, { oldAPI } from 'old-api';\n`);
  context.replaceImport("old-api", "new-api", { oldAPI: "newAPI" });
  expect(context.readFile("default.ts")).toContain("{ oldAPI }");
  expect(manualSteps[1].message).toContain("default imports need review");
});

test("multi-version planning is ordered and shared; apply and retry are idempotent", () => {
  const { root, write } = fixture();
  write(".spark/version", "0.0.1-next.4\n");
  write("package.json", '{ "scripts": { "check": "old" }, "custom": true }\n');
  write("app.json", '{ "expo": { "name": "Keep" } }\n');
  write("src/old.ts", "import { oldAPI } from 'old-module';\noldAPI();\n");
  write("managed.js", "old template");
  const steps: Migration[] = [
    { version: "0.0.1-next.5", automatic: false, apply(c) {
      c.editJson<{ scripts: Record<string, string> }>("package.json", p => { p.scripts.check = "new"; });
      c.renameFile("src/old.ts", "src/new.ts");
      c.writeFile("created.txt", "first");
    } },
    { version: "0.0.1-next.6", automatic: false, apply(c) {
      expect(c.readFile("src/old.ts")).toBeNull();
      expect(c.readFile("src/new.ts")).toContain("oldAPI");
      c.replaceImport("old-module", "new-module", { oldAPI: "newAPI" });
      c.editJson<{ expo: { name: string; updated?: boolean } }>("app.json", p => { p.expo.updated = true; });
      c.writeFile("created.txt", "final");
    } },
    { version: "0.0.1-next.7", automatic: false, apply(c) {
      c.updateTemplate("managed.js", "old template", "new template");
      c.manualStep("Rebuild the custom module and verify startup.");
    } },
  ];
  // Deliberately register out of order; semantic version order owns execution.
  migrations.push(...[...steps].reverse());
  const plan = planMigrations(root, "0.0.1-next.7");
  expect(plan.versions).toEqual(steps.map(step => step.version));
  expect(plan.changes.find(change => change.file === "src/new.ts")).toEqual({ file: "src/new.ts", before: null, after: "import { newAPI as oldAPI } from 'new-module';\noldAPI();\n" });
  expect(existsSync(path.join(root, "src/new.ts"))).toBe(false);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.1-next.4\n");
  expect(existsSync(path.join(root, ".spark/upgrade-notes.md"))).toBe(false);
  expect(() => migrateProject(root, "0.0.1-next.7")).toThrow("Run spark upgrade");
  applyMigrationPlan(root, plan);
  expect(existsSync(path.join(root, "src/old.ts"))).toBe(false);
  expect(readFileSync(path.join(root, "created.txt"), "utf8")).toBe("final");
  expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo).toEqual({ name: "Keep", updated: true });
  const notes = readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8");
  expect(notes).toContain("[0.0.1-next.7](../node_modules/@legendapp/spark/skills/spark/UPGRADING.md#001-next7)");
  const time = statSync(path.join(root, "created.txt")).mtimeMs;
  expect(planMigrations(root, "0.0.1-next.7").changes).toEqual([]);
  // Simulate failure before receipt finalization: earlier edits must rerun safely.
  write(".spark/version", "0.0.1-next.4\n");
  const retry = planMigrations(root, "0.0.1-next.7");
  expect(retry.changes).toEqual([]);
  applyMigrationPlan(root, retry);
  expect(statSync(path.join(root, "created.txt")).mtimeMs).toBe(time);
  expect(readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8")).toBe(notes);
  write(".spark/upgrade-notes.md", notes.replace('- [ ]', '- [x]'));
  write(".spark/version", "0.0.1-next.4\n");
  migrateProject(root, "0.0.1-next.7", false);
  expect(readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8")).toBe(notes.replace('- [ ]', '- [x]'));
  // A later upgrade retains earlier unresolved manual work.
  migrateProject(root, "0.0.1-next.8", false);
  expect(readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8")).toBe(notes.replace('- [ ]', '- [x]'));
});

test("planning failure and changed input leave every file and receipt untouched", () => {
  const { root, write } = fixture();
  write(".spark/version", "0.0.1-next.4\n"); write("input.txt", "old");
  migrations.push({ version: "0.0.1-next.5", automatic: false, apply(c) { c.writeFile("input.txt", "new"); throw new Error("failed step"); } });
  expect(() => planMigrations(root, "0.0.1-next.5")).toThrow("failed step");
  expect(readFileSync(path.join(root, "input.txt"), "utf8")).toBe("old");
  migrations.pop();
  migrations.push({ version: "0.0.1-next.5", automatic: false, apply(c) { c.writeFile("input.txt", "new"); c.writeFile("second.txt", "new"); } });
  const plan = planMigrations(root, "0.0.1-next.5");
  write("input.txt", "user edit");
  expect(() => applyMigrationPlan(root, plan)).toThrow("input changed");
  expect(existsSync(path.join(root, "second.txt"))).toBe(false);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.1-next.4\n");
});

test("real next.2 → next.4 migration updates JSON and paths but reports semantic changes", () => {
  const { root, write } = fixture();
  write(".spark/version", "0.0.1-next.2\n");
  const window = { width: 1000, height: 700, minWidth: 400, minHeight: 300, restoreFrame: true, material: "sidebar", trafficLights: false };
  write("desktop.config.json", JSON.stringify({ name: "App", window }));
  write("app.json", JSON.stringify({ expo: { name: "Keep", extra: { spark: { window } } } }));
  write("src/App.ts", `import { showMessageDialog } from '@legendapp/spark/message-dialog';\n`);
  write("metro.config.js", `const { getDefaultConfig } = require('@legendapp/spark/expo-metro');\n`);
  const plan = planMigrations(root, "0.0.1-next.4");
  expect(plan.versions).toEqual(["0.0.1-next.3", "0.0.1-next.4"]);
  applyMigrationPlan(root, plan);
  const after = JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8")).window;
  expect(after).toEqual({ size: { width: 1000, height: 700 }, minSize: { width: 400, height: 300 }, restoreBounds: true, macos: { backgroundMaterial: "sidebar", titleBar: { trafficLights: false } } });
  expect(JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo.extra.spark.window).toEqual(after);
  expect(readFileSync(path.join(root, "src/App.ts"), "utf8")).toContain("@legendapp/spark/dialogs");
  expect(readFileSync(path.join(root, "metro.config.js"), "utf8")).toContain("@legendapp/spark/metro");
  expect(plan.manualSteps[0].message).toContain("API contracts");
});

test("real migration preserves conflicting and incomplete dimensions for manual review", () => {
  const { root, write } = fixture();
  write(".spark/version", "0.0.1-next.2\n");
  const window = { width: 1000, height: 700, size: { width: 800, height: 500 }, minWidth: 400, restoreFrame: true, restoreBounds: false };
  write("desktop.config.json", JSON.stringify({ window }));
  const plan = planMigrations(root, "0.0.1-next.4");
  expect(plan.changes.some(change => change.file === "desktop.config.json")).toBe(false);
  expect(plan.manualSteps.map(step => step.message).join("\n")).toContain("incomplete or conflicting dimensions");
  expect(plan.manualSteps.map(step => step.message).join("\n")).toContain("restoreFrame/restoreBounds");
});
