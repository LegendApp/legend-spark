import { afterEach, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { CommandError, errorPresentation, releaseCommand, reportError } from "../packages/cli/src/errors.ts";
import { commandRedactor } from "../packages/cli/src/commands.ts";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test.each([0, 10_000_000_000])("release disk space preserves 15 GB plus %s headroom on every destination", headroom => {
  const source = readFileSync(new URL("../scripts/release.ts", import.meta.url), "utf8");
  // Exercise the CLI's check without starting a release or touching its checkpoint.
  const check = source.slice(source.indexOf("    function checkSpace("), source.indexOf("    mkdirSync("));
  expect(source).toContain("if (heavy) checkSpace(10_000_000_000)");
  const destinations = ["/System/Volumes/Data", "/release", "/temporary", "/spark"];
  for (const destination of destinations) {
    for (const delta of [1, 0, -1]) {
      const statfsSync = vi.fn((file: string) => ({ bavail: file === destination ? 15_000_000_000 + headroom + delta : 100_000_000_000, bsize: 1 }));
      const run = () => runInNewContext(`${check}\ncheckSpace(headroom);`, {
        statfsSync, headroom, args: [], root: "/release", process: { env: { TMPDIR: "/temporary" } }, sparkHome: () => "/spark/home", path,
      });
      if (delta > 0) {
        expect(run).not.toThrow();
        expect(statfsSync.mock.calls.map(([file]) => file)).toEqual(destinations);
      } else expect(run).toThrow(`Insufficient disk space on ${destination}: ${((15_000_000_000 + headroom + delta) / 1e9).toFixed(1)} GB available. Preserve the 15 GB reserve`);
    }
  }
});

test("authentication, network and failed checks show actionable messages", () => {
  expect(errorPresentation(new CommandError(["npm", "whoami"], 1, "npm error E401 Unauthorized"))).toEqual({
    summary: "npm authentication failed.", next: "Run npm login, then retry the same release command.",
  });
  expect(errorPresentation(new CommandError(["npm", "view", "@legendapp/spark"], 1, "npm error E401 Unauthorized")).summary).toBe("npm authentication failed.");
  expect(errorPresentation(new CommandError(["gh", "auth", "status"], 1, "not logged in")).next).toContain("gh auth login");
  expect(errorPresentation(new CommandError(["xcrun", "notarytool", "history"], 1, "NSURLErrorDomain Code=-1009 (huge nested Apple diagnostic)")).summary).toBe("Could not reach Apple’s notarization service.");
  expect(errorPresentation(new CommandError(["npm", "whoami"], 1, "ENOTFOUND registry.npmjs.org")).next).toContain("internet connection");
  expect(errorPresentation(new CommandError(["bun", "run", "test"], 1, "assertion failure")).summary).toBe("Tests failed.");
  expect(errorPresentation(new Error("Release artifact changed: spark.tgz")).summary).toBe("Release artifact changed: spark.tgz");
});

test("default reporting keeps stacks and full redacted diagnostics in the log", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-errors-"));
  try {
    vi.stubEnv("SPARK_DEBUG", undefined);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "private-test-secret";
    const argv = ["xcrun", "notarytool", "--password", secret];
    const { redact } = commandRedactor(argv);
    const detail = `begin ${secret} ${"full diagnostic ".repeat(300)} end`;
    reportError(root, new CommandError(argv.map(redact), 1, redact(detail)));
    const text = output.mock.calls.map(call => call.join(" ")).join("\n");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("full diagnostic");
    expect(text).not.toMatch(/\n\s+at /);
    const log = text.match(/Details: (.+)/)![1]!;
    const saved = readFileSync(log, "utf8");
    expect(saved).toContain(redact(detail));
    expect(saved).toMatch(/\n\s+at /);
    expect(saved).not.toContain(secret);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a caught failure exits unsuccessfully, while pending notarization retains exit 2", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-errors-"));
  const previous = process.exitCode;
  try {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await releaseCommand(root, async () => { process.exitCode = 2; });
    expect(process.exitCode).toBe(2);
    await releaseCommand(root, async () => { throw new Error("No release to resume"); });
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = previous; rmSync(root, { recursive: true, force: true }); }
});

test("reporting still explains the failure when a diagnostic log cannot be written", () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "spark-errors-"));
  try {
    const root = path.join(folder, "file");
    writeFileSync(root, "not a directory");
    vi.stubEnv("SPARK_DEBUG", undefined);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(root, new Error("Insufficient disk space"));
    const text = output.mock.calls.map(call => call.join(" ")).join("\n");
    expect(text).toContain("Release stopped: Insufficient disk space");
    expect(text).toContain("Could not save diagnostics");
    expect(text).not.toContain("Details:");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test.each([
  ["scripts/release.ts", ["--unknown"], "Unknown option"],
  ["scripts/prepare-release.ts", [], "Usage:"],
  ["scripts/publish-release.ts", ["--unknown"], "Usage:"],
])("%s handles expected failures without Bun source excerpts or stacks", (script, args, message) => {
  const result = spawnSync("bun", [script, ...args], { encoding: "utf8", env: { ...process.env, SPARK_DEBUG: "" } });
  const output = result.stdout + result.stderr;
  const log = output.match(/Details: (.+)/)?.[1];
  try {
    expect(result.status, output).toBe(1);
    expect(output).toContain(`Release stopped: ${message}`);
    expect(output).not.toMatch(/\n\s+at |\d+ \|/);
    expect(log).toBeDefined();
    expect(readFileSync(log!, "utf8")).toContain(message);
  } finally { if (log) rmSync(log, { force: true }); }
});
