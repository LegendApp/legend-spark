import { expect, test } from "vitest";
import { clipboardRoundTrip, secureStorageLifecycle, fileConflict } from "../examples/kitchen-sink/contract-cases.ts";
import { catalog, executeCase, initialResults, summarize } from "../examples/kitchen-sink/contract-report.ts";
import { acceptRuntimeMessage, record, renderReports, validateReport, type TestReport } from "../scripts/testing/report.ts";
function fixture(platform: "windows" | "web" = "windows", scope: "prepare" | "runtime" = "runtime"): TestReport {
  const results = initialResults(platform);
  return { schema: "spark-platform-tests/v1", runId: crypto.randomUUID(), source: { commit: "abc123", dirty: false, fingerprint: "source-one" },
    target: { platform, arch: "arm64", device: "test", mode: "dev" }, host: { platform: "darwin", arch: "arm64" },
    scope, startedAt: "2026-09-15", execution: "running", project: "fixture", versions: {}, results, summary: summarize(results) };
}
test("coverage distinguishes missing implementations, not applicable, and absent evidence", () => {
  const windows = fixture(), web = fixture("web");
  expect(windows.results.find(c => c.id === "ui.button")?.status).toBe("not-tested");
  expect(windows.results.find(c => c.id === "desktop.tray")?.status).toBe("not-tested");
  expect(web.results.find(c => c.id === "storage.lifecycle")?.status).toBe("not-applicable");
  record(web, { id: "storage.unavailable", status: "passed" });
  expect(web.results.find(c => c.id === "storage.lifecycle")?.status).toBe("not-applicable");
  expect(web.summary.complete).toBe(false);
  expect(new Set(catalog.map(c => c.id)).size).toBe(catalog.length);
});
test("bundle passes cannot become runtime acceptance or hide a missing implementation", () => {
  const report = fixture("windows", "prepare");
  record(report, { id: "build.bundle", status: "passed" });
  expect(() => record(report, { id: "ui.button", status: "passed" })).toThrow("Preparation");
  expect(() => record(report, { id: "build.native", status: "passed" })).toThrow("Preparation");
  expect(report.results.find(c => c.id === "ui.button")?.status).toBe("not-tested");
  expect(() => record(fixture(), { id: "distribution.standalone", status: "passed" })).toThrow("implemented support");
  expect(() => record(fixture(), { id: "ui.button", status: "missing-implementation" })).toThrow("has an implementation");
});
test("a backend E_UNAVAILABLE is a failure and a later pass cannot erase it", async () => {
  const result = await executeCase("storage.lifecycle", async () => { throw Object.assign(new Error("Backend missing"), { code: "E_UNAVAILABLE" }); });
  expect(result.status).toBe("failed");
  const report = fixture(); record(report, result);
  record(report, { id: result.id, status: "passed" });
  expect(report.results.find(c => c.id === result.id)?.status).toBe("failed");
});
test("report import rejects duplicate, missing, unknown and impossible claims", () => {
  const report = fixture(); validateReport(report);
  report.results.pop(); expect(() => validateReport(report)).toThrow("Incomplete");
  const duplicate = fixture(); duplicate.results.push(duplicate.results[0]!);
  expect(() => validateReport(duplicate)).toThrow("duplicate");
  const forged = fixture("windows", "prepare"); forged.results.find(c => c.id === "ui.button")!.status = "passed";
  expect(() => validateReport(forged)).toThrow("Invalid execution claim");
});
test("matrix preserves repeated failures and separates source revisions", () => {
  const first = fixture(), second = fixture();
  record(first, { id: "ui.button", status: "failed", detail: "No callback" });
  record(second, { id: "ui.button", status: "passed" });
  const third = fixture(); third.source.fingerprint = "other-source";
  const markdown = renderReports([first, second, third]);
  expect(markdown).toContain("failed | passed");
  expect(markdown.match(/^## /gm)).toHaveLength(2);
  expect(markdown).toContain("not-tested");
  expect(markdown).toContain("No callback");
});
test("clipboard case restores text even when native readback is wrong", async () => {
  const writes: string[] = [];
  let reads = 0;
  await expect(clipboardRoundTrip({ getStringAsync: async () => reads++ === 0 ? "original" : "wrong", hasStringAsync: async () => true,
    setStringAsync: async value => { writes.push(value); return true; } }, "probe")).rejects.toThrow("round trip");
  expect(writes).toEqual(["probe", "original"]);
});
test("secure-storage case detects bad readback and removes its own credential", async () => {
  const deleted: string[] = [];
  let written = false;
  await expect(secureStorageLifecycle({ isAvailableAsync: async () => true, getItemAsync: async () => written ? "wrong" : null,
    setItemAsync: async () => { written = true; }, deleteItemAsync: async key => { deleted.push(key); } }, "unique-key")).rejects.toThrow("round trip");
  expect(deleted).toEqual(["unique-key", "unique-key"]);
});
test("file case detects an implementation that silently ignores conflicts", async () => {
  await expect(fileConflict({ writeText: async () => {}, writeTextIfUnchanged: async () => ({ written: true }), readText: async () => "after" }, "owned-test-file")).rejects.toThrow("conflict");
});


test("runtime messages cannot mix platforms, stale binaries or build claims into API coverage", () => {
  const report = fixture(), allowed = new Set(["clipboard.read"]);
  const message = { runId: report.runId, complete: true, runtime: { platform: "windows", hermes: true, native: { platform: "windows", arch: "arm64", mode: "dev", fingerprint: "expected" } }, results: [{ id: "clipboard.read", status: "passed" }] };
  expect(() => acceptRuntimeMessage(report, message, allowed, "different")).toThrow("identity");
  expect(report.summary.counts.passed).toBe(0);
  const forged = { ...message, results: [...message.results, { id: "build.native", status: "passed" }] };
  expect(() => acceptRuntimeMessage(report, forged, allowed, "expected")).toThrow("cannot attest");
  expect(report.summary.counts.passed).toBe(0);
  expect(() => acceptRuntimeMessage(report, { ...message, runtime: { ...message.runtime, platform: "ios" } }, allowed, "expected")).toThrow("platform");
  expect(() => acceptRuntimeMessage(report, { ...message, results: [...message.results, ...message.results] }, allowed, "expected")).toThrow("duplicate");
  expect(acceptRuntimeMessage(report, message, allowed, "expected")).toBe(true);
  expect(report.summary.counts.passed).toBe(2);
});
