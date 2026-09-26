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

test("hotkey replacement serializes native registration and releases event subscriptions", async () => {
  const hotkeys = await import("../packages/global-shortcuts/src/global-hotkey");
  const listener = vi.fn();
  const handle = hotkeys.addGlobalHotkeyListener(listener);
  await Promise.all([hotkeys.registerGlobalHotkey(49), hotkeys.registerGlobalHotkey(50)]);
  expect(mocks.call.mock.calls.map(([method]) => method)).toEqual(["register", "remove", "register"]);
  expect(mocks.events.size).toBe(1);
  for (const emit of mocks.events) {
    emit({ type: "globalShortcut", id: "another-app-command" });
    emit({ type: "globalShortcut", id: "spark.primary-hotkey" });
  }
  expect(listener).toHaveBeenCalledTimes(1);
  handle.remove();
  await hotkeys.unregisterGlobalHotkey();
  expect(mocks.events.size).toBe(0);
});

test("a failed hotkey registration cleans up and does not poison later registrations", async () => {
  const hotkeys = await import("../packages/global-shortcuts/src/global-hotkey");
  mocks.call.mockRejectedValueOnce(new Error("Shortcut is in use"));
  expect(await hotkeys.registerGlobalHotkey(49)).toEqual({ success: false, message: "Shortcut is in use" });
  expect(mocks.events.size).toBe(0);
  expect(await hotkeys.registerGlobalHotkey(50)).toEqual({ success: true });
  await hotkeys.unregisterGlobalHotkey();
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
