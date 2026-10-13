import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/privileged-helper/macos");
const helper = path.join(root, "packages/privileged-helper/helper");
const flags = ["-fobjc-arc", "-fblocks", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-I", helper];
const frameworks = ["-framework", "AppKit", "-framework", "ServiceManagement", "-framework", "Security"];

test.skipIf(process.platform !== "darwin")("status, ServiceManagement, prompt and XPC errors map explicitly, unsigned builds stop before ServiceManagement, a real XPC round trip to an anonymous listener checks both signatures, the simulation answers every outcome, and the core and the Kitchen Sink helper build", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-privileged-helper-native-"));
  try {
    const service = path.join(directory, "service.o");
    await runOk("clang", [...flags, "-c", path.join(helper, "SparkPrivilegedHelperService.m"), "-o", service], { timeout: 60000 });
    const binary = path.join(directory, "test");
    await runOk("clang++", [...flags, "-std=c++20", "-DSPARK_TEST_DRIVER=1", ...frameworks, path.join(root, "tests/privileged-helper.native.mm"), path.join(macos, "SparkPrivilegedHelpers.mm"), service, "-o", binary], { timeout: 60000 });
    // The helper refuses clients without the hardened runtime: sign the test binary (its own client) ad hoc with it.
    await runOk("codesign", ["--force", "--sign", "-", "--options", "runtime", binary], { timeout: 30000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Privileged helper native tests passed");
    // Builds without the test driver compile without the simulation.
    await runOk("clang++", [...flags, "-std=c++20", "-DSPARK_TEST_DRIVER=0", "-c", path.join(macos, "SparkPrivilegedHelpers.mm"), "-o", path.join(directory, "release.o")], { timeout: 60000 });
    // The Kitchen Sink's helper compiles and links against the helper side alone (never run: it would serve a Mach service).
    await runOk("clang", [...flags, "-framework", "Foundation", "-framework", "Security", path.join(root, "examples/kitchen-sink/helpers/privileged-helper/main.m"), path.join(helper, "SparkPrivilegedHelperService.m"), "-o", path.join(directory, "privileged-helper")], { timeout: 60000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120000);
