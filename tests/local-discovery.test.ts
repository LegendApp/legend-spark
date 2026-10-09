import { expect, onTestFinished, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { availablePort, findGo, findProject, packageManifest, registerPackages, registerRuntime } from "../packages/cli/src/local.ts";
import { VERSION, writeJson, type NativePackage } from "../packages/cli/src/project.ts";
import { sessionStatus } from "../packages/cli/src/session-status.ts";
import { buildMode } from "../packages/cli/src/build-mode.ts";

test("build defaults to standalone release and rejects conflicting modes", () => {
  expect(buildMode({})).toBe("release");
  expect(buildMode({ dev: true })).toBe("dev");
  expect(buildMode({ preview: true })).toBe("preview");
  expect(buildMode({ runner: true })).toBe("go");
  expect(() => buildMode({ runner: true, dev: true })).toThrow("only one");
  expect(buildMode({ release: true })).toBe("release");
  expect(() => buildMode({ dev: true, release: true })).toThrow("only one");
});

const module: NativePackage = { name: "dialogs", root: "/dialogs", json: {}, sdk: true, requires: [], signature: "current" };

test("runtime discovery uses native compatibility, survives deleted binaries, and ignores other SDKs", () => {
  vi.stubEnv("SPARK_MACOS_ARCH", "arm64"); onTestFinished(() => { vi.unstubAllEnvs(); });
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-discovery-"));
  const previous = process.env.SPARK_HOME;
  process.env.SPARK_HOME = path.join(root, "cache");
  function runtime(name: string, signature: string, version = VERSION) {
    const app = path.join(root, `${name}.app`);
    mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
    writeJson(path.join(app, "Contents/Resources/spark-runtime.json"), {
      schema: 1, framework: version, platform: "macos", arch: "arm64", mode: "go", fingerprint: name, modules: { dialogs: signature },
    });
    return app;
  }
  try {
    const old = runtime("old", "old");
    const current = runtime("current", "current");
    registerRuntime(old);
    registerRuntime(current);
    expect(findGo([module], old)?.app).toBe(current);
    expect(() => registerRuntime(runtime("other-sdk", "current", "99.0.0"))).toThrow("Not a compatible");
    rmSync(current, { recursive: true });
    expect(findGo([module], current)?.app).toBe(old);
    rmSync(old, { recursive: true });
    expect(findGo([module])).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.SPARK_HOME;
    else process.env.SPARK_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("app discovery walks past nested packages to the application root", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-project-"));
  try {
    writeJson(path.join(root, "app.json"), { expo: { name: "App" } });
    writeJson(path.join(root, "package.json"), { name: "app" });
    writeJson(path.join(root, "src/component/package.json"), { name: "component" });
    expect(findProject(path.join(root, "src/component"))).toBe(root);
    expect(() => findProject(os.tmpdir())).toThrow("No spark app found");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing Go install differs from missing native modules and stale custom builds", () => {
  const missing = sessionStatus("go", false, []);
  expect(missing.compatible).toBe(false);
  expect(missing.canBuild).toBe(false);
  expect(missing.message).toContain("isn’t installed");
  const custom = sessionStatus("go", true, ["Greeting isn’t included in the Spark Runner."]);
  expect(custom.canBuild).toBe(true);
  expect(custom.actions).toContain("b  Build and open");
  expect(sessionStatus("dev", true, ["changed"]).actions).toContain("Rebuild and open");
  expect(sessionStatus("go", true, []).compatible).toBe(true);
});

test("automatic ports skip any listening server and explicit ports fail clearly", async () => {
  const server = createServer();
  // Reserve the normal default if possible; otherwise test the already occupied default.
  let ownsDefault = false;
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve() : reject(error));
    server.listen(19120, () => { ownsDefault = true; resolve(); });
  });
  try {
    expect(await availablePort()).toBeGreaterThan(19120);
    await expect(availablePort(19120)).rejects.toThrow("Omit --port");
    await expect(availablePort(NaN)).rejects.toThrow("integer");
    await expect(availablePort(65536)).rejects.toThrow("integer");
  } finally {
    if (ownsDefault) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("package registration rejects incomplete SDK archives", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-packages-"));
  try {
    const manifest = path.join(root, "manifest.json");
    writeJson(manifest, { "@legendapp/spark-cli": "missing.tgz" });
    expect(() => registerPackages(manifest)).toThrow("Missing local archive");
    expect(() => packageManifest(manifest)).toThrow("spark sdk pack");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
