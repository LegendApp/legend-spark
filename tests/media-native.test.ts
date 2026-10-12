import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/media/macos");
const flags = ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos];
const frameworks = ["AppKit", "AVFoundation", "AVKit", "CoreMedia", "Speech"].flatMap(name => ["-framework", name]);
const sources = ["SparkVideo.mm", "SparkSpeech.mm"].map(file => path.join(macos, file));

test.skipIf(process.platform !== "darwin")("video players play the silent clip, seek, report status and simulate fullscreen and picture in picture; speech validates, records and times utterances and scripts recognition; the cores build without the driver", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-media-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", [...flags, "-DSPARK_TEST_DRIVER=1", ...frameworks, path.join(root, "tests/media.native.mm"), ...sources, "-o", binary], { timeout: 90000 });
    expect(await runOk(binary, [path.join(root, "tests/fixtures/media/test-clip.mp4")], { timeout: 60000 })).toContain("Media native tests passed");
    // Builds without the test driver compile without the simulation.
    for (const source of sources) await runOk("clang++", [...flags, "-DSPARK_TEST_DRIVER=0", "-c", source, "-o", path.join(directory, `${path.basename(source)}.o`)], { timeout: 60000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 180000);
