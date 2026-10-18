import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportSDK, importSDK, verifySDK, treeHashes } from "../packages/cli/src/sdk-transfer.ts";
import { writeJson } from "../packages/cli/src/project.ts";
test("SDK can move before registration; altered packages fail verification", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-sdk-transfer-")); const home = process.env.SPARK_HOME;
  try {
    process.env.SPARK_HOME = path.join(root, "home"); mkdirSync(path.join(root, "source"));
    const packages = { "@legendapp/spark": "frame.tgz" };
    for (const file of Object.values(packages)) writeFileSync(path.join(root, "source", file), file);
    writeJson(path.join(root, "source/manifest.json"), packages);
    exportSDK(path.join(root, "source/manifest.json"), path.join(root, "export"));
    renameSync(path.join(root, "export"), path.join(root, "relocated"));
    expect(importSDK(path.join(root, "relocated"))).toBe(path.join(root, "relocated"));
    if (process.platform !== "win32") {
      const bin = path.join(root, "bin"); mkdirSync(bin);
      writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env node
  const fs = require("node:fs"), assert = require("node:assert/strict");
  const config = JSON.parse(fs.readFileSync("pnpm-workspace.yaml", "utf8"));
  assert.equal(config.nodeLinker, "hoisted");
  assert.ok(JSON.parse(fs.readFileSync("package.json", "utf8")).pnpm.onlyBuiltDependencies.includes("@legendapp/spark@file:../packages/frame.tgz"));
  assert.equal(config.allowBuilds["@legendapp/spark@file:../packages/frame.tgz"], true);
  assert.equal(config.allowBuilds["react-native-enriched-markdown"], true);
  assert.equal(config.overrides["@legendapp/spark"], "file:" + require("node:path").resolve("../packages/frame.tgz").replaceAll("\\\\", "/"));
  fs.mkdirSync("node_modules/@legendapp/spark/bin", {recursive:true});
  fs.writeFileSync("node_modules/@legendapp/spark/bin/spark.cjs", "process.exit(0)");
  `, { mode: 0o755 });
      expect(execFileSync("node", [path.join(root, "relocated/install.mjs"), "--package-manager", "pnpm"], { cwd: root, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }, encoding: "utf8" })).toContain("SDK installed.");
    }
    writeFileSync(path.join(root, "relocated/packages/frame.tgz"), "changed");
    expect(() => verifySDK(path.join(root, "relocated"))).toThrow("checksum");
  } finally { if (home === undefined) delete process.env.SPARK_HOME; else process.env.SPARK_HOME = home; rmSync(root, { recursive: true, force: true }); }
});
test("SDK refuses native-runtime symlinks outside its directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-sdk-link-"));
  try { mkdirSync(path.join(root, "runtimes")); symlinkSync(os.tmpdir(), path.join(root, "runtimes/outside")); expect(() => treeHashes(root)).toThrow("escapes"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
