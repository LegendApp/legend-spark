import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/logging/macos");

// The harness checks the core; the zip it leaves is then read back with unzip, independently of Foundation.
test.skipIf(process.platform !== "darwin")("logging core: JSON lines, rotation, write failures, the unified log and a diagnostics zip", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-logging-native-"));
  try {
    const binary = path.join(directory, "test");
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-I", path.join(root, "packages/desktop-app/macos"),
      "-framework", "Foundation", "-framework", "OSLog", path.join(root, "tests/logging.native.mm"), path.join(macos, "SparkLogging.mm"), "-o", binary], { timeout: 60000 });
    expect(execFileSync(binary, [directory], { encoding: "utf8", timeout: 60000 })).toContain("Logging native tests passed");

    const zip = path.join(directory, "export/Diagnostics.zip");
    const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(name => name && !name.endsWith("/") && !name.startsWith("__MACOSX"));
    expect(entries.sort()).toEqual(["Diagnostics/diagnostics.json", "Diagnostics/logs/app.1.log", "Diagnostics/logs/app.log"]);
    const diagnostics = JSON.parse(execFileSync("unzip", ["-p", zip, "Diagnostics/diagnostics.json"], { encoding: "utf8" }));
    expect(diagnostics).toMatchObject({
      format: 1,
      app: { processIdentifier: expect.any(Number) },
      system: { os: "macOS", osVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/), architecture: process.arch === "arm64" ? "arm64" : "x86_64", processorCount: os.cpus().length, physicalMemoryBytes: os.totalmem() },
      logging: { level: "debug", files: { directory: path.join(directory, "logs"), maxFileBytes: 4096, maxFiles: 2 } },
      info: { ticket: "KS-1", flags: ["beta"] },
    });
    expect(Date.parse(diagnostics.createdAt)).toBeGreaterThan(Date.now() - 60000);
    // Only these details, so no user name, host name or serial number.
    expect(Object.keys(diagnostics.app).sort()).toEqual(["build", "bundleIdentifier", "name", "processIdentifier", "version"]);
    expect(Object.keys(diagnostics.system).sort()).toEqual(["architecture", "locale", "lowPowerMode", "model", "os", "osBuild", "osVersion", "physicalMemoryBytes", "preferredLanguages", "processorCount", "thermalState", "timeZone", "translated", "uptimeSeconds"]);
    const last = execFileSync("unzip", ["-p", zip, "Diagnostics/logs/app.log"], { encoding: "utf8" }).trim().split("\n").map(line => JSON.parse(line)).at(-1);
    expect(last).toMatchObject({ level: "info", category: "external", message: "After the limit" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
