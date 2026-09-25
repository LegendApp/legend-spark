import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { macOSArchitecture, macOSXcodeArchitecture } from "../packages/cli/src/platform.ts";
import { runtimeFor, writeJson } from "../packages/cli/src/project.ts";
import { findGo, registerRuntime, readRuntime } from "../packages/cli/src/local.ts";

test("macOS target detection, cross compilation override, and Xcode spelling", () => {
  expect(macOSArchitecture("arm64", {})).toBe("arm64");
  expect(macOSArchitecture("x86_64", {})).toBe("x64");
  expect(macOSArchitecture("arm64", { SPARK_MACOS_ARCH: "x64" })).toBe("x64");
  expect(macOSArchitecture("x86_64", { SPARK_MACOS_ARCH: "arm64" })).toBe("arm64");
  expect(() => macOSArchitecture("arm64", { SPARK_MACOS_ARCH: "bad" })).toThrow();
  expect(() => macOSArchitecture("unknown", {})).toThrow();
  expect(macOSXcodeArchitecture("x64")).toBe("x86_64");
});

test("macOS target changes fingerprints and selects only matching registered Runners", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-macos-arch-"));
  const previous = { arch: process.env.SPARK_MACOS_ARCH, home: process.env.SPARK_HOME };
  try {
    process.env.SPARK_HOME = path.join(root, "home");
    writeJson(path.join(root, "package.json"), { name: "probe", dependencies: {} });
    writeJson(path.join(root, "app.json"), { expo: { name: "Probe", platforms: ["macos"] } });
    const fingerprints: string[] = [];
    for (const arch of ["arm64", "x64"]) {
      process.env.SPARK_MACOS_ARCH = arch;
      const runtime = runtimeFor(root, [], "go");
      fingerprints.push(runtime.fingerprint);
      const app = path.join(root, arch + ".app");
      mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
      writeJson(path.join(app, "Contents/Resources/spark-runtime.json"), runtime);
      registerRuntime(app);
      expect(readRuntime(app)?.arch).toBe(arch);
    }
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
    expect(findGo([], path.join(root, "arm64.app"))?.runtime.arch).toBe("x64");
    process.env.SPARK_MACOS_ARCH = "arm64";
    expect(findGo([], path.join(root, "x64.app"))?.runtime.arch).toBe("arm64");
  } finally {
    if (previous.arch === undefined) delete process.env.SPARK_MACOS_ARCH; else process.env.SPARK_MACOS_ARCH = previous.arch;
    if (previous.home === undefined) delete process.env.SPARK_HOME; else process.env.SPARK_HOME = previous.home;
    rmSync(root, { recursive: true, force: true });
  }
});
