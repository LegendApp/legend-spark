import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const { applyPatch, parsePatch, reversePatch } = createRequire(import.meta.url)("diff");

test.skipIf(process.platform !== "darwin")("covered markdown text leaves the cursor to the overlay above it", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const pkg = path.join(root, "node_modules/react-native-enriched-markdown");
  const files = ["ios/views/ENRMContextMenuTextView+macOS.h", "ios/views/ENRMContextMenuTextView+macOS.m"];
  const hunk = (text: string, file: string) => parsePatch(text).find(patch => patch.newFileName === `b/${file}`)!;
  const base = readFileSync(path.join(pkg, ".spark-base.patch"), "utf8");
  const patch = readFileSync(path.join(root, "patches", JSON.parse(readFileSync(path.join(root, "patches/dependencies.json"), "utf8"))["react-native-enriched-markdown"].patch), "utf8");
  // Rebuild the sources from upstream and this checkout's patch, whichever patch the install applied.
  const source = files.map(file => {
    const upstream = applyPatch(readFileSync(path.join(pkg, file), "utf8"), reversePatch(hunk(base, file)));
    return (applyPatch(upstream as string, hunk(patch, file)) as string).split("\n").filter(line => !/^#(import|pragma once)/.test(line)).join("\n");
  }).join("\n");
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-enrm-cursor-"));
  try {
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/enriched-markdown-cursor.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("ENRM cursor probe passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
