import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyHelpers, resolveHelpers, type Helpers } from "../packages/cli/src/helpers.ts";
import { runtimeFor } from "../packages/cli/src/project.ts";
import { toExpo } from "@legendapp/spark-desktop-config/config.cjs";
function fixture(run: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-helpers-"));
  try { for (const target of ["mac", "win"]) { mkdirSync(path.join(root, target, "bin"), { recursive: true }); writeFileSync(path.join(root, target, "bin/backend"), target); writeFileSync(path.join(root, target, "data.json"), "{}"); } run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const helpers: Helpers = { backend: {
  "macos-arm64": { directory: "mac", executable: "bin/backend" },
  "windows-x64": { directory: "win", executable: "bin/backend" },
} };
// Fixtures ship a macos-arm64 bundle; pin the target so the host CPU (e.g. x64 Linux CI) is irrelevant.
beforeEach(() => { vi.stubEnv("SPARK_MACOS_ARCH", "arm64"); });
afterEach(() => { vi.unstubAllEnvs(); });
test("helper selection uses target architecture and fingerprints all assets", () => fixture(root => {
  expect(resolveHelpers(root, helpers, "windows", "x64")[0]?.files).toEqual(["win/bin/backend", "win/data.json"]);
  expect(() => resolveHelpers(root, helpers, "windows", "arm64")).toThrow("windows-arm64");
  mkdirSync(path.join(root, "mac/empty"));
  copyHelpers(root, path.join(root, "App.app"), helpers);
  const output = path.join(root, "App.app/Contents/Helpers/backend.helper");
  expect(existsSync(path.join(output, "empty"))).toBe(true);
  expect(readFileSync(path.join(output, ".spark-entry"), "utf8")).toBe("bin/backend");
  expect(readFileSync(path.join(output, "data.json"), "utf8")).toBe("{}");
  copyHelpers(root, path.join(root, "App.app"), {});
  expect(existsSync(output)).toBe(false);
}));
test("helper bundles reject escaping paths, parent symlinks and asset symlinks", () => fixture(root => {
  for (const executable of ["../win/bin/backend", "/bin/echo", "C:/tool.exe", "bin\\backend", "bin/../backend"]) expect(() => resolveHelpers(root, { backend: { "macos-arm64": { directory: "mac", executable } } })).toThrow();
  symlinkSync(path.join(root, "mac"), path.join(root, "linked"));
  expect(() => resolveHelpers(root, { backend: "linked/bin/backend" })).toThrow("symlink");
  symlinkSync("/etc/hosts", path.join(root, "mac/asset"));
  expect(() => resolveHelpers(root, helpers)).toThrow("symlink");
}));
test("configuration accepts target bundles and catches invalid declarations early", () => {
  const base = { name: "Helpers", projectId: "helpers", version: "1", macos: { bundleIdentifier: "com.test.helpers" } };
  expect(toExpo({ ...base, helpers }).expo.extra?.spark?.helpers).toEqual(helpers);
  for (const value of [{ backend: "mac/bin/backend", BACKEND: "mac/bin/backend" }, { backend: {} }, { backend: { windows: { directory: "win", executable: "backend" } } }, { backend: { "windows-x64": { directory: "win", executable: "backend", typo: true } } }]) expect(() => toExpo({ ...base, helpers: value })).toThrow();
});

test("changing bundled assets invalidates a custom runtime fingerprint", () => fixture(root => {
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test", dependencies: {} }));
  writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ name: "Test", projectId: "test", version: "1.0.0", macos: { bundleIdentifier: "com.test.helper" }, helpers }));
  const before = runtimeFor(root, [], "dev").fingerprint;
  writeFileSync(path.join(root, "mac/data.json"), '{"changed":true}');
  expect(runtimeFor(root, [], "dev").fingerprint).not.toBe(before);
  copyHelpers(root, path.join(root, "Win"), helpers, "windows", "x64");
  expect(readFileSync(path.join(root, "Win/Helpers/backend.helper/bin/backend"), "utf8")).toBe("win");
  expect(readFileSync(path.join(root, "Win/Helpers/backend.helper/.spark-entry"), "utf8")).toBe("bin/backend");
}));
