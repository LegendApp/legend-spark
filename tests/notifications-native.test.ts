import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("notification startup preserves host categories and serializes background completion with queued shows", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-notification-categories-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/notifications/macos/RNDesktopNotifications.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith("#import") && !line.startsWith("- (std::shared_ptr<facebook::react::TurboModule>)")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/notifications.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "Foundation", "-framework", "AppKit", "-framework", "UserNotifications", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 10000 })).toContain("Notification categories passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
