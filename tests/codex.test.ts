import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ platform: { OS: "macos" }, load: vi.fn(), availability: vi.fn(), run: vi.fn(), cancel: vi.fn(), shutdown: vi.fn() }));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("../packages/codex/src/native", () => ({ loadCodex: mocks.load }));
import { getCodexAvailability, runCodexPrompt, cancelActiveCodexRuns, shutdownCodex } from "../packages/codex/src";
beforeEach(async () => {
  mocks.shutdown.mockReturnValue(0); await shutdownCodex(); mocks.platform.OS = "macos";
  mocks.load.mockReset().mockReturnValue({ getAvailability: mocks.availability, runPrompt: mocks.run, cancelActiveRuns: mocks.cancel, shutdown: mocks.shutdown });
  mocks.availability.mockReset().mockResolvedValue({ available: true, codexPath: "/bin/codex", message: "", userAgent: "test" });
  mocks.run.mockReset().mockResolvedValue({ model: "test", output: "{}", threadId: "t", turnId: "r", userAgent: "test" });
  mocks.cancel.mockReset().mockReturnValue(2); mocks.shutdown.mockReset().mockReturnValue(1);
});
test("Codex import/availability is safe without the optional module or supported platform", async () => {
  mocks.platform.OS = "ios";
  await expect(getCodexAvailability()).resolves.toMatchObject({ available: false, reason: "unsupported-platform" }); expect(mocks.load).not.toHaveBeenCalled();
  mocks.platform.OS = "macos"; mocks.load.mockImplementation(() => { throw Error("not linked"); });
  await expect(getCodexAvailability()).resolves.toMatchObject({ available: false, reason: "missing-module" });
  await expect(runCodexPrompt("test")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
test("Codex snapshots options, validates results and owns process-wide shutdown/restart", async () => {
  const schema = { type: "object" }; await runCodexPrompt("test", { outputSchema: schema, timeoutMs: 1000, developerInstructions: "instructions" });
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("test", "", "low", 1000, '{"type":"object"}', "instructions");
  await expect(cancelActiveCodexRuns()).resolves.toBe(2); await expect(shutdownCodex()).resolves.toBe(1);
  await expect(shutdownCodex()).resolves.toBe(0); await runCodexPrompt("again"); expect(mocks.load).toHaveBeenCalledTimes(2);
  mocks.run.mockResolvedValue({ output: "bad" }); await expect(runCodexPrompt("test")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("Codex invalid options cause no native allocation and shutdown errors allow retry", async () => {
  await expect(runCodexPrompt("test", { timeoutMs: NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(runCodexPrompt("test", { timeoutMs: 999 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(runCodexPrompt("test", { timeoutMs: 86_400_001 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(runCodexPrompt("test", { timeoutMs: 1000.5 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(runCodexPrompt("test", { backend: {} } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(mocks.load).not.toHaveBeenCalled(); await runCodexPrompt("test");
  mocks.shutdown.mockImplementationOnce(() => { throw Error("busy"); }); await expect(shutdownCodex()).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(shutdownCodex()).resolves.toBe(1);
});
