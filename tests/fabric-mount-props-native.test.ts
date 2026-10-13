import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("split view, motion view and drag view apply their props on a null-oldProps mount", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-fabric-mount-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const motion = path.join(root, "packages/motion");
    const source = ["ui/macos/RNSparkLayoutDirection.h", "ui/macos/appkit-split-view/RNSidebarSplitViewComponent.mm", "motion/macos/RNSparkMotionView.mm", "drag-drop/macos/SparkDragSession.h", "drag-drop/macos/SparkDragSession.mm", "drag-drop/macos/RNDesktopDragView.mm"]
      .map(name => readFileSync(path.join(root, "packages", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    // Motion's sources import <RNDesktopApp/…> headers (SparkWindowTransitions.h).
    mkdirSync(path.join(directory, "include"));
    symlinkSync(path.join(root, "packages/desktop-app/macos"), path.join(directory, "include/RNDesktopApp"));
    writeFileSync(input, readFileSync(path.join(root, "tests/fabric-mount-props.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", "static NSString *SparkLocalizedString(NSString *key) { return key; }\n" + source));
    await runOk("clang++", [
      "-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-I", path.join(motion, "macos"), "-I", path.join(motion, "cpp"), "-I", path.join(directory, "include"),
      "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "CoreImage", "-framework", "Symbols", "-framework", "Metal", "-framework", "UniformTypeIdentifiers",
      input, path.join(motion, "macos/SparkMotionCoordinator.mm"), path.join(motion, "macos/SparkMotionMaterial.mm"), path.join(motion, "macos/SparkMotionShape.mm"), path.join(motion, "macos/SparkMotionShader.mm"),
      path.join(motion, "macos/SparkMotionEmitter.mm"), path.join(motion, "macos/SparkMotionFlight.mm"), path.join(motion, "cpp/SparkMotion.cpp"), "-o", output,
    ], { timeout: 60000 });
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Fabric mount props passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
