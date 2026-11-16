import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin" || Number(os.release().split(".")[0]) < 25)(
  "native split subclass supports public safe-area layout before and after mounting", async () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-public-split-"));
    try {
      const root = path.resolve(import.meta.dirname, "..");
      const source = readFileSync(path.join(root, "packages/ui/macos/appkit-split-view/RNSidebarSplitViewComponent.mm"), "utf8");
      const classes = source.slice(source.indexOf("@interface RNSidebarSplitViewNativeSplitView"), source.indexOf("static char RNSidebarSplitViewStartupKey;"));
      const fixture = readFileSync(path.join(root, "tests/public-split-layout.native.m"), "utf8");
      const input = path.join(temporary, "probe.m"), binary = path.join(temporary, "probe");
      writeFileSync(input, fixture.replace("// SDK_CLASSES", "#define SDK_SPLIT_PROBE 1\n" + classes));
      await runOk("clang", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", "-framework", "QuartzCore", input, "-o", binary]);
      for (const mode of ["owned-sdk-before", "owned-sdk-after", "embedded-sdk-before", "embedded-sdk-after", "embedded-sdk-zero-premount-before"]) {
        expect(await runOk(binary, [mode], { timeout: 15000 })).toContain(`PASS ${mode}`);
      }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }, 30000,
);
