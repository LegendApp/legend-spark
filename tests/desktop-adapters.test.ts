import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  run: vi.fn(),
  events: new Set<(event: any) => void>(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "macos" } }));
vi.mock("../packages/global-shortcuts/src/NativeDesktopGlobalShortcuts", () => ({ default: { call: mocks.call } }));
vi.mock("../packages/processes/src/NativeDesktopProcesses", () => ({ default: { call: mocks.call } }));
vi.mock("../packages/processes/src/index", () => ({ runCommand: mocks.run }));
vi.mock("@legendapp/spark-desktop-app", () => ({
  onDesktopEvent: (listener: (event: any) => void) => {
    mocks.events.add(listener);
    return { remove: () => mocks.events.delete(listener) };
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.call.mockReset().mockResolvedValue("null");
  mocks.run.mockReset();
  mocks.events.clear();
});

test("command adapters use the shared process implementation and preserve batch order", async () => {
  const { commandRunner } = await import("../packages/processes/src/command-runner");
  mocks.call.mockImplementation(async (_method, json) => JSON.stringify(`/bin/${JSON.parse(json).command}`));
  mocks.run.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false });
  await commandRunner.runCommands([
    { command: "first", args: ["a"], cwd: "/tmp", input: "data" },
    { command: "second", timeoutMs: 1000 },
  ]);
  expect(mocks.run.mock.calls).toEqual([
    [{ executable: "/bin/first", args: ["a"], cwd: "/tmp", input: "data" }],
    [{ executable: "/bin/second", timeoutMs: 1000 }],
  ]);
  mocks.call.mockResolvedValue("null");
  await expect(commandRunner.runCommand({ command: "missing" })).rejects.toMatchObject({ code: "command_not_found" });
  expect(mocks.run).toHaveBeenCalledTimes(2);
});
