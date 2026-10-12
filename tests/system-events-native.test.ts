import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/system/macos");

test.skipIf(process.platform !== "darwin")("system event observers install OS sources outside driver runs and none in them, where only simulated events arrive", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spark-system-events-"));
  try {
    const source = (await readFile(path.join(macos, "SparkSystemState.mm"), "utf8"))
      .replace("#import <RNDesktopApp/SparkDesktop.h>", "").replace("#import <RNDesktopApp/SparkTestDriver.h>", "");
    const [prelude, checks] = (await readFile(path.join(root, "tests/system-events.native.mm"), "utf8")).split("// ACTUAL_IMPLEMENTATION\n");
    const main = path.join(directory, "main.mm"), binary = path.join(directory, "test");
    await writeFile(main, prelude + source + checks);
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-Wno-unused-function", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=1", "-I", macos,
      "-framework", "AppKit", "-framework", "IOKit", "-framework", "Network", "-framework", "SystemConfiguration", main, path.join(macos, "SparkAppearancePreferences.mm"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("System event native tests passed");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 90000);
