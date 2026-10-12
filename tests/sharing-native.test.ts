import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/sharing/macos");
const frameworks = ["AppKit", "CoreSpotlight", "UniformTypeIdentifiers"].flatMap(name => ["-framework", name]);

test.skipIf(process.platform !== "darwin")("share items, declared services and Spotlight items validate before any picker or index call, Services run on a private pasteboard, the simulation records everything, and the core builds without the driver", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-sharing-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=1", "-I", macos, ...frameworks,
      path.join(root, "tests/sharing.native.mm"), path.join(macos, "SparkSharing.mm"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Sharing native tests passed");
    // Builds without the test driver compile without the simulation.
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=0", "-I", macos, "-c",
      path.join(macos, "SparkSharing.mm"), "-o", path.join(directory, "release.o")], { timeout: 60000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
