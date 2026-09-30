import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), resolve: vi.fn(), availability: vi.fn() }));
vi.mock("@legendapp/spark-processes", () => ({ runCommand: mocks.run, resolveCommand: mocks.resolve, getProcessAvailability: mocks.availability }));
import { runAITool, getAICommandAvailability, buildAIInvocation } from "../packages/ai/src";
beforeEach(() => { mocks.run.mockReset(); mocks.resolve.mockReset(); mocks.availability.mockReset().mockReturnValue({ available: true }); });
test("AI availability resolves installed tools without running a prompt", async () => {
  mocks.resolve.mockImplementation(async name => name === "codex" ? "/bin/codex" : null);
  await expect(getAICommandAvailability({ preferredTool: "codex" })).resolves.toEqual({ claude: false, codex: true, preferredTool: "codex" });
  expect(mocks.run).not.toHaveBeenCalled();
  mocks.availability.mockReturnValue({ available: false, reason: "missing-module" });
  await expect(getAICommandAvailability()).resolves.toEqual({ claude: false, codex: false, preferredTool: null });
});
test("AI run delegates bytes, cancellation, limits and nonzero exit to Spark processes", async () => {
  const result = { stdout: new TextEncoder().encode(" response\n"), stderr: new Uint8Array(), exit: { type: "exited", code: 7 }, timedOut: false, aborted: false, outputTruncated: true };
  mocks.run.mockResolvedValue(result); const signal = new AbortController().signal;
  await expect(runAITool({ tool: "codex", prompt: "test", signal, timeoutMs: 500, cwd: "/work" })).resolves.toEqual({ ...result, output: "response", tool: "codex" });
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ target: { type: "command", name: "codex" }, input: "test", signal, timeoutMs: 500, cwd: "/work" }));
});
test("invalid AI requests reject before process execution", async () => {
  for (const input of [{ tool: "unknown", prompt: "test" }, { tool: "claude", prompt: "" }, { tool: "codex", prompt: "test", runner: {} }, { tool: "claude", prompt: "test", invocationOptions: { codex: {} } }]) {
    await expect(runAITool(input as never)).rejects.toBeDefined();
  }
  expect(mocks.run).not.toHaveBeenCalled();
  expect(() => buildAIInvocation("codex", "test", { codex: { reasoningEffort: "bad" } } as never)).toThrow();
});
