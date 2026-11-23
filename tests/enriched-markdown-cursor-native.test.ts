import { expect, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPatch, parsePatch, reversePatch, type StructuredPatch } from "diff";
import { runOk } from "./subprocess.ts";

test.skipIf(process.platform !== "darwin")("covered markdown text leaves the cursor to the overlay above it", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const pkg = path.join(root, "node_modules/react-native-enriched-markdown");
  const files = ["ios/views/ENRMContextMenuTextView+macOS.h", "ios/views/ENRMContextMenuTextView+macOS.m"];
  const hunk = (patches: StructuredPatch[], file: string) => patches.find(patch => patch.newFileName === `b/${file}`)!;
  const pins = JSON.parse(readFileSync(path.join(root, "patches/dependencies.json"), "utf8"));
  const base = parsePatch(readFileSync(path.join(pkg, ".spark-base.patch"), "utf8"));
  const patch = parsePatch(readFileSync(path.join(root, "patches", pins["react-native-enriched-markdown"].patch), "utf8"));
  // Rebuild the sources from upstream and this checkout's patch, whichever patch the install applied.
  const source = files.map(file => {
    const upstream = applyPatch(readFileSync(path.join(pkg, file), "utf8"), reversePatch(hunk(base, file)));
    assert(upstream !== false, `Cannot reverse the installed patch for ${file}`);
    const patched = applyPatch(upstream, hunk(patch, file));
    assert(patched !== false, `Cannot apply the checkout's patch to ${file}`);
    return patched.split("\n").filter(line => !/^#(import|pragma once)/.test(line)).join("\n");
  }).join("\n");
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-enrm-cursor-"));
  try {
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/enriched-markdown-cursor.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 15000 })).toContain("ENRM cursor probe passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
