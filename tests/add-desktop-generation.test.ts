import { afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDesktop } from "../packages/cli/src/add-desktop.ts";
import { installWithEnrichedHtmlPins } from "../packages/cli/src/enriched-html-pins.ts";
import { ensureProjectVersion } from "../packages/cli/src/project-version.ts";

vi.mock("../packages/cli/src/enriched-html-pins.ts", () => ({ installWithEnrichedHtmlPins: vi.fn() }));
const roots: string[] = [];
const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
function write(root: string, name: string, content: object | string) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), typeof content === "string" ? content : JSON.stringify(content));
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([false, true])("desktop adoption stamps only after installation succeeds (failure: %s)", async fail => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-desktop-generation-"));
  roots.push(root);
  const dependencies = { expo: "55.0.32", react: "19.2.0", "react-native": "0.83.10" };
  write(root, "package.json", { name: "existing-mobile", dependencies });
  for (const [name, version] of Object.entries(dependencies)) write(root, `node_modules/${name}/package.json`, { name, version });
  write(root, "node_modules/expo/node_modules/@expo/config/index.js", 'exports.getConfig = () => ({ exp: { name: "Existing", platforms: ["ios", "android", "web"] } });\n');
  write(root, "spark.tgz", "local archive fixture");
  write(root, "packages.json", { "@legendapp/spark": "spark.tgz" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(installWithEnrichedHtmlPins).mockImplementation(async () => {
    expect(existsSync(path.join(root, ".spark/version"))).toBe(false);
    if (fail) throw new Error("install failed");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    for (const [name, installed] of Object.entries(pkg.dependencies)) write(root, `node_modules/${name}/package.json`, { version: name === "@legendapp/spark" ? version : installed });
  });
  if (fail) {
    await expect(addDesktop(root, path.join(root, "packages.json"))).rejects.toThrow("install failed");
    expect(existsSync(path.join(root, ".spark/version"))).toBe(false);
    fail = false;
    await addDesktop(root, path.join(root, "packages.json"));
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
    ensureProjectVersion(root);
  } else {
    await addDesktop(root, path.join(root, "packages.json"));
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
    expect(existsSync(path.join(root, ".spark/upgrade-notes.md"))).toBe(false);
    ensureProjectVersion(root);
  }
});
