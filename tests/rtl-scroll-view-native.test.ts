import { afterAll, beforeAll, expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { patchScrollViewSource, installRTLScrollViewPatch, replacements } = require("../packages/config-plugin/rtl-scroll-view.cjs");
const file = path.join(path.dirname(require.resolve("react-native-macos/package.json")), "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine = (replacements as [string, string][]).reduce((source, [before, after]) => source.replace(after, before), readFileSync(file, "utf8"));
const patched: string = patchScrollViewSource(pristine);
const between = (start: string, end: string) => {
  const from = patched.indexOf(start), to = patched.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Patched ScrollView source has no ${start}`);
  return patched.slice(from, to + end.length);
};

test("RTL scroll patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  expect(patched).not.toBe(pristine);
  expect(patchScrollViewSource(patched)).toBe(patched);
  expect(() => patchScrollViewSource(pristine.replace("CGAffineTransformMakeScale(-1, 1)", "CGAffineTransformMakeScale(-1.0, 1.0)"))).toThrow("source changed");
  // iOS keeps its mirrored scroll view; macOS mirrors nothing.
  const layoutMetrics = between("- (void)updateLayoutMetrics:", "#endif // macOS]\n}\n");
  expect(layoutMetrics.slice(0, layoutMetrics.indexOf("#else"))).toContain("_containerView.transform = transform;\n    _scrollView.transform = transform;");
  expect(layoutMetrics.slice(layoutMetrics.indexOf("#else"))).not.toContain("transform");
});

test("RTL scroll patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-scroll-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.mm");
    const installed = path.join(dependency, "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm");
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.83.0" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installRTLScrollViewPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installRTLScrollViewPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installRTLScrollViewPatch(root)).toThrow("requires react-native-macos@0.83.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-scroll-test-"));
  const input = path.join(directory, "RTLScroll.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "rtl-scroll-view.native.mm"), "utf8")
    .replace("// ACTUAL_HELPER", between("static void RCTPreserveRTLRightEdge(", "\n}\n"))
    .replace("// ACTUAL_UPDATE_LAYOUT_METRICS", between("- (void)updateLayoutMetrics:", "#endif // macOS]\n}\n"))
    .replace("// ACTUAL_CONTENT_SIZE", between("  // contentSize reads the container", "  });\n")));
  await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["rtl-start", "first-content", "content-growth", "resize", "ltr", "vertical", "hit"])("AppKit RTL ScrollView: %s", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
