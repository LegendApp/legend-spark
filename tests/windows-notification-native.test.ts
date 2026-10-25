import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("Windows notification payloads preserve body/action arguments and use valid toast nesting and call audio", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-notifications-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/notifications/windows/SparkNotifications/SparkNotifications.h"), "utf8");
    const start = source.indexOf('    Xml::XmlDocument xml; xml.LoadXml(L"<toast><visual><binding template=', source.indexOf("  void Show("));
    const end = source.indexOf("    auto tag = Hash(id);", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/windows-notification.native.mm"), "utf8").replace("// ACTUAL_PAYLOAD", source.slice(start, end)));
    await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "Foundation", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 10000 })).toContain("Windows notification payloads passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
