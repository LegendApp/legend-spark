import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const motion = path.join(root, "packages/motion");

function compileAndRun(sources: string[], flags: string[]) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-motion-native-"));
  try {
    const binary = path.join(directory, "test");
    execFileSync("clang++", ["-std=c++20", "-Wall", "-Werror", "-I", path.join(motion, "cpp"), ...flags, ...sources, path.join(motion, "cpp/SparkMotion.cpp"), "-o", binary], { timeout: 60000 });
    return execFileSync(binary, { encoding: "utf8", timeout: 15000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test.skipIf(process.platform !== "darwin")("portable motion engine: closed-form curves, velocity hand-off, validation, timelines, baking and virtual clock", () => {
  expect(compileAndRun([path.join(root, "tests/motion-engine.native.cpp")], ["-O1"])).toContain("Motion engine tests passed");
}, 90000);

test.skipIf(process.platform !== "darwin")("macOS coordinator rejects malformed requests, bakes onto layers and drives the virtual clock", () => {
  const flags = ["-fobjc-arc", "-fblocks", "-mmacosx-version-min=14.0", "-I", path.join(motion, "macos"), "-framework", "AppKit", "-framework", "QuartzCore"];
  expect(compileAndRun([path.join(root, "tests/motion-coordinator.native.mm"), path.join(motion, "macos/SparkMotionCoordinator.mm")], flags)).toContain("Motion coordinator tests passed");
}, 90000);
