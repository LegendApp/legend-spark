import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/permissions/macos");
const frameworks = ["AppKit", "ApplicationServices", "AVFoundation", "Contacts", "CoreGraphics", "CoreLocation", "EventKit", "IOKit", "Photos"].flatMap(name => ["-framework", name]);

test.skipIf(process.platform !== "darwin")("permission states map explicitly, validation fails before TCC, and the simulation prompts once per answer", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-permissions-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=1", "-I", macos, ...frameworks,
      path.join(root, "tests/permissions.native.mm"), path.join(macos, "SparkPermissions.mm"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Permission native tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
