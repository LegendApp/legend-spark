import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { installWorkspaceAdapters } from "../scripts/install-workspace-adapters.ts";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-workspace-adapter-"));
  const pkg = path.join(root, "node_modules/probe"); mkdirSync(pkg, { recursive: true });
  mkdirSync(path.join(root, "patches/workspace"), { recursive: true });
  writeFileSync(path.join(root, "patches/workspace/upstream.json"), JSON.stringify({ probe: { version: "1.0.0", integrity: "sha512-probe" } }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { probe: "1.0.0" }, sparkWorkspacePatches: { "probe@1.0.0": "probe.patch" } }));
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0" }));
  writeFileSync(path.join(root, "cache.js"), "old\n"); linkSync(path.join(root, "cache.js"), path.join(pkg, "index.js"));
  writeFileSync(path.join(root, "probe.patch"), "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/windows/nested/module.cpp b/windows/nested/module.cpp\nnew file mode 100644\n--- /dev/null\n+++ b/windows/nested/module.cpp\n@@ -0,0 +1 @@\n+native\n");
  return { root, pkg, close: () => rmSync(root, { recursive: true, force: true }) };
}
test("workspace adapters add nested native files, preserve cache hardlinks, and survive reinstall", () => {
  const f = fixture();
  try {
    installWorkspaceAdapters(f.root); installWorkspaceAdapters(f.root);
    expect(readFileSync(path.join(f.pkg, "index.js"), "utf8")).toBe("new\n");
    expect(readFileSync(path.join(f.root, "cache.js"), "utf8")).toBe("old\n");
    expect(readFileSync(path.join(f.pkg, "windows/nested/module.cpp"), "utf8")).toBe("native\n");
    expect(JSON.parse(readFileSync(path.join(f.pkg, "package.json"), "utf8")).spark.workspacePatch).toMatchObject({ schema: 1, version: "1.0.0", upstreamIntegrity: "sha512-probe" });
  } finally { f.close(); }
});
test("workspace adapters reject an unexpected upstream version or changed source", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.pkg, "index.js"), "unrecognized\n");
    expect(() => installWorkspaceAdapters(f.root)).toThrow("Cannot apply");
    writeFileSync(path.join(f.pkg, "package.json"), JSON.stringify({ name: "probe", version: "2.0.0" }));
    expect(() => installWorkspaceAdapters(f.root)).toThrow("needs probe@1.0.0");
  } finally { f.close(); }
});
