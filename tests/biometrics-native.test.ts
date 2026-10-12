import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/biometrics/macos");
const flags = ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos];

test.skipIf(process.platform !== "darwin")("LAError and Keychain statuses map explicitly, validation fails before LocalAuthentication, the simulation answers every outcome without a prompt, and the core builds without the driver", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-biometrics-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", [...flags, "-DSPARK_TEST_DRIVER=1", "-framework", "Foundation", "-framework", "LocalAuthentication", "-framework", "Security",
      path.join(root, "tests/biometrics.native.mm"), path.join(macos, "SparkBiometrics.mm"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Biometric native tests passed");
    // Builds without the test driver compile without the simulation.
    await runOk("clang++", [...flags, "-DSPARK_TEST_DRIVER=0", "-c", path.join(macos, "SparkBiometrics.mm"), "-o", path.join(directory, "release.o")], { timeout: 60000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
