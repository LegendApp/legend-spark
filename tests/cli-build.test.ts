import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("rebuilding the source CLI preserves helpers used by active dev sessions", async () => {
  const { buildCLI } = await import(new URL("../scripts/build-node.mjs", import.meta.url).href);
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-cli-build-"));
  const source = path.join(root, "packages/cli/src");
  const output = path.join(root, "packages/cli/dist");
  try {
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "index.ts"), "export const value: number = 1;");
    writeFileSync(path.join(source, "helper.cjs"), "module.exports = true;");
    buildCLI(root);
    const directory = statSync(output).ino;
    const helper = statSync(path.join(output, "helper.cjs")).ino;
    writeFileSync(path.join(source, "index.ts"), "export const value: number = 2;");
    buildCLI(root);
    expect(statSync(output).ino).toBe(directory);
    expect(statSync(path.join(output, "helper.cjs")).ino).toBe(helper);
    expect(readFileSync(path.join(output, "index.js"), "utf8")).toContain("value = 2");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
