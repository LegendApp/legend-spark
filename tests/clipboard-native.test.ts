import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

// The shipped SparkClipboard against a private pasteboard (tests/clipboard.native.mm); the general pasteboard is never
// read or written, and each scenario checks that its change count did not move.
let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-clipboard-test-"));
  const native = path.resolve(import.meta.dirname, "../packages/clipboard/macos");
  executable = path.join(directory, "clipboard");
  await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-Werror=unguarded-availability-new", "-I", native, "-framework", "AppKit",
    path.join(import.meta.dirname, "clipboard.native.mm"), path.join(native, "SparkClipboard.mm"), "-o", executable], { timeout: 60000 });
}, 90000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each([
  ["operations", "text, HTML, rich and file writes and reads, change count, clearing, and concealed/transient markers on the first item"],
  ["promised", "promised types are provided one at a time on demand, providers are released, failures and timeouts give the paste nothing, and teardown stops asking"],
  ["monitoring", "change polling starts with the first registration, reports changes once with the latest count, shares one timer and stops with the last"],
])("clipboard: %s (%s)", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
