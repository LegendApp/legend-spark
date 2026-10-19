import { afterEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { assertNativePatchPreflight } from "../packages/cli/src/native-patch-preflight.ts";
import { enrichedHtmlPinIssues, repairEnrichedHtmlPins, enrichedHtmlPins } from "../packages/cli/src/enriched-html-pins.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(manager = "npm", isolated = false, fixed = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-web-pins-")); roots.push(root);
  const json = (file: string, value: any) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); };
  json(path.join(root, "package.json"), { name: "app", packageManager: manager, dependencies: { react: "19.1.4", "react-dom": "19.1.4" } });
  function pkg(base: string, name: string, version: string, dependencies = {}) {
    const directory = path.join(base, "node_modules", name);
    json(path.join(directory, "package.json"), { name, version, dependencies, main: "index.js", exports: { ".": "./index.js" } });
    writeFileSync(path.join(directory, "index.js"), ""); return directory;
  }
  pkg(root, "react", "19.1.4");
  const sdk = pkg(root, "@legendapp/spark", "1.0.0");
  const base = isolated ? path.join(root, "node_modules/.pnpm/html") : root;
  const html = pkg(base, "react-native-enriched-html", "1.1.1", Object.fromEntries(Object.keys(enrichedHtmlPins).map(name => [name, "*"])));
  if (isolated) { mkdirSync(path.join(sdk, "node_modules")); symlinkSync(html, path.join(sdk, "node_modules/react-native-enriched-html")); }
  const resolved = isolated ? path.dirname(path.dirname(html)) : root;
  for (const [name, version] of Object.entries(enrichedHtmlPins)) pkg(resolved, name, fixed ? version : name === "dompurify" ? "3.4.11" : "3.27.1");
  pkg(resolved, "react-dom", fixed ? "19.1.4" : "19.3.1");
  return { root, json, pkg, resolved };
}
for (const manager of ["npm@12.0.2", "bun@1.3.14", "yarn@1.22.22", "pnpm@10.34.0", "pnpm@11.28.6"]) {
  test(`${manager} detects importer versions and writes manager pins idempotently`, () => {
    const { root } = fixture(manager, manager.startsWith("pnpm"));
    const issues = enrichedHtmlPinIssues(root);
    expect(issues.find(issue => issue.package === "dompurify")?.found).toBe("3.4.11");
    expect(issues.find(issue => issue.package === "react-dom")?.expected).toBe("19.1.4");
    repairEnrichedHtmlPins(root, manager.split("@")[0] as any);
    const manifest = readFileSync(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(manifest);
    const pins = manager.startsWith("pnpm") ? pkg.pnpm.overrides : manager.startsWith("yarn") ? pkg.resolutions : pkg.overrides;
    expect(pins).toMatchObject({ ...enrichedHtmlPins, "react-dom": "19.1.4" });
    const yaml = manager.startsWith("pnpm") ? readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8") : undefined;
    if (yaml) { expect(parse(yaml).overrides).toEqual(pins); expect(parse(yaml).nodeLinker).toBeUndefined(); }
    repairEnrichedHtmlPins(root, manager.split("@")[0] as any);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(manifest);
    if (yaml) expect(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).toBe(yaml);
  });
}
test("fixed graphs and apps without enriched-html leave configuration untouched", () => {
  const { root } = fixture("npm", false, true);
  const before = readFileSync(path.join(root, "package.json"), "utf8");
  expect(enrichedHtmlPinIssues(root)).toEqual([]);
  repairEnrichedHtmlPins(root, "npm");
  expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  rmSync(path.join(root, "node_modules/react-native-enriched-html"), { recursive: true });
  expect(enrichedHtmlPinIssues(root)).toEqual([]);
});
test("preserves newer explicit JSON and YAML pins and unrelated workspace settings", () => {
  const { root, json } = fixture("pnpm@11.28.6", true);
  const file = path.join(root, "package.json");
  json(file, { ...JSON.parse(readFileSync(file, "utf8")), pnpm: { overrides: { dompurify: "3.4.19" } } });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "# workspace\npackages: [apps/*]\noverrides:\n  '@tiptap/core': 3.33.0\n");
  repairEnrichedHtmlPins(root, "pnpm");
  expect(JSON.parse(readFileSync(file, "utf8")).pnpm.overrides.dompurify).toBe("3.4.19");
  const yaml = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  expect(yaml).toContain("# workspace"); expect(parse(yaml).packages).toEqual(["apps/*"]);
  expect(parse(yaml).overrides["@tiptap/core"]).toBe("3.33.0");
});
test("checks nested Tiptap peers and aligns a conflicting direct renderer", () => {
  const { root, pkg, json, resolved } = fixture();
  const tiptap = path.join(resolved, "node_modules/@tiptap/react");
  pkg(tiptap, "react-dom", "19.3.1");
  pkg(resolved, "react-dom", "19.1.4");
  const file = path.join(root, "package.json");
  json(file, { ...JSON.parse(readFileSync(file, "utf8")), dependencies: { react: "19.1.4", "react-dom": "19.1.0" } });
  expect(enrichedHtmlPinIssues(root).some(issue => issue.package === "react-dom")).toBe(true);
  repairEnrichedHtmlPins(root, "npm");
  expect(JSON.parse(readFileSync(file, "utf8")).dependencies["react-dom"]).toBe("19.1.4");
});

test("repair preserves a newer direct dependency and nested npm override", () => {
  const { root, json } = fixture();
  const file = path.join(root, "package.json");
  json(file, { ...JSON.parse(readFileSync(file, "utf8")), dependencies: { react: "19.1.4", dompurify: "3.4.19" }, overrides: { dompurify: { ".": "$dompurify", child: "1.0.0" } } });
  repairEnrichedHtmlPins(root, "npm");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  expect(pkg.dependencies.dompurify).toBe("3.4.19");
  expect(pkg.overrides.dompurify).toEqual({ ".": "$dompurify", child: "1.0.0" });
});


test("existing native preflight repairs web pins before native preparation", () => {
  const { root } = fixture();
  expect(() => assertNativePatchPreflight(root)).toThrow("Run npm install");
  expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).overrides).toMatchObject(enrichedHtmlPins);
});


test("preserves each adequate explicit pin without reconciling newer user choices", () => {
  const { root, json } = fixture("pnpm@11.28.6", true);
  const file = path.join(root, "package.json");
  json(file, { ...JSON.parse(readFileSync(file, "utf8")), dependencies: { react: "19.1.4", dompurify: "~3.4.18" }, pnpm: { overrides: { dompurify: "3.4.19" } } });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "overrides:\n  dompurify: 3.4.20\n");
  repairEnrichedHtmlPins(root, "pnpm");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  expect(pkg.pnpm.overrides.dompurify).toBe("3.4.19");
  expect(pkg.dependencies.dompurify).toBe("~3.4.18");
  expect(parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).overrides.dompurify).toBe("3.4.20");
});

test("checks installed optional Tiptap menus from their declaring package", () => {
  const { root, json, pkg, resolved } = fixture("npm", false, true);
  const html = path.join(root, "node_modules/react-native-enriched-html/package.json");
  json(html, { name: "react-native-enriched-html", version: "1.1.1", dependencies: { "@tiptap/react": enrichedHtmlPins["@tiptap/react"] } });
  const react = path.join(resolved, "node_modules/@tiptap/react/package.json");
  json(react, { name: "@tiptap/react", version: enrichedHtmlPins["@tiptap/react"], optionalDependencies: { "@tiptap/extension-bubble-menu": "^3.27.1", "@tiptap/extension-floating-menu": "^3.27.1" } });
  pkg(resolved, "@tiptap/extension-bubble-menu", "3.27.1");
  pkg(resolved, "@tiptap/extension-floating-menu", "3.27.1");
  expect(enrichedHtmlPinIssues(root).map(issue => issue.package).sort()).toEqual(["@tiptap/extension-bubble-menu", "@tiptap/extension-floating-menu"]);
  repairEnrichedHtmlPins(root, "npm");
  expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).overrides).toMatchObject(enrichedHtmlPins);
});
