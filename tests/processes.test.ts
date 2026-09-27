import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "macos" }, listeners: new Set<(event: any) => void>() }));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: () => ({ call: mocks.call }) } }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (listener: (event: any) => void) => { mocks.listeners.add(listener); return { remove: () => { mocks.listeners.delete(listener); } }; } }));
import { spawn, runCommand, resolveCommand } from "../packages/processes/src/index";
const options = { target: { type: "executable" as const, path: "/bin/cat" } };
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function emit(event: any) { for (const listener of mocks.listeners) listener(event); }
function exit(id: string, extra = {}) { emit({ type: "processExit", processId: id, result: { exitCode: 0, terminated: false, terminationSignal: null, stdoutBase64: "", stderrBase64: "", timedOut: false, outputTruncated: false, ...extra } }); }
beforeEach(() => { mocks.call.mockReset().mockResolvedValue("null"); mocks.listeners.clear(); mocks.platform.OS = "macos"; });
test("one target contract resolves commands and snapshots options before async resolution", async () => {
  let resolve!: (value: string) => void;
  mocks.call.mockImplementation(method => method === "resolveCommand" ? new Promise(done => { resolve = done; }) : Promise.resolve("null"));
  const input = new Uint8Array([0, 255]), args = ["first"], env = { VALUE: "first" };
  const pending = spawn({ target: { type: "command", name: "cat" }, args, env, input, captureLimitBytes: 1 });
  input[0] = 1; args[0] = "changed"; env.VALUE = "changed"; resolve('"/bin/cat"');
  const child = await pending;
  expect(JSON.parse(mocks.call.mock.calls.at(-1)![1])).toMatchObject({ executable: "/bin/cat", args: ["first"], env: { VALUE: "first" }, inputBase64: "AP8=", captureLimitBytes: 1 });
  exit(child.id);
  mocks.call.mockResolvedValue("null"); await expect(resolveCommand("missing")).resolves.toBeNull();
  await expect(spawn({ target: { type: "command", name: "missing" } })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});
test("writes preserve invocation order, close joins and retries, byte input snapshots immediately", async () => {
  const child = await spawn(options);
  let release!: () => void, closes = 0;
  mocks.call.mockImplementation(async method => {
    if (method === "write" && !release) await new Promise<void>(done => { release = done; });
    if (method === "closeInput" && ++closes === 1) throw Error("close failed");
    return "null";
  });
  const bytes = new Uint8Array([0, 255]), one = child.write(bytes), two = child.write("text"); bytes[0] = 7;
  const closing = child.closeInput(), also = child.closeInput(); expect(closing).toBe(also);
  await expect(child.write("late")).rejects.toMatchObject({ code: "E_CLOSED" });
  await tick(); expect(mocks.call.mock.calls.filter(([method]) => method === "write")).toHaveLength(1);
  release(); await one; await two; await expect(closing).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(JSON.parse(mocks.call.mock.calls.find(([method]) => method === "write")![1]).base64).toBe("AP8=");
  await child.closeInput(); expect(closes).toBe(2); exit(child.id);
});
test("termination joins, retries failed requests and waits for exit after native acknowledgement", async () => {
  const child = await spawn(options);
  mocks.call.mockRejectedValueOnce(Error("stop failed"));
  await expect(child.terminate()).rejects.toMatchObject({ code: "E_NATIVE" });
  const first = child.terminate(), second = child.terminate(); expect(first).toBe(second);
  let complete = false; void first.then(() => { complete = true; }); await tick(); expect(complete).toBe(false);
  exit(child.id, { exitCode: 15, terminated: true, terminationSignal: 15 });
  await first; expect((await child.exited).exit).toEqual({ type: "terminated", signal: 15 });
  expect(mocks.listeners.size).toBe(0);
});
test("abort during native spawn terminates after allocation and retains partial byte output", async () => {
  let release!: (value: string) => void, id = "";
  mocks.call.mockImplementation((method, json) => {
    id = JSON.parse(json).id;
    return method === "spawn" ? new Promise(done => { release = done; }) : Promise.resolve("null");
  });
  const controller = new AbortController(), pending = spawn({ ...options, signal: controller.signal });
  controller.abort(); release("null"); const child = await pending;
  await tick(); expect(mocks.call.mock.calls.some(([method]) => method === "terminate")).toBe(true);
  exit(id, { exitCode: 1, terminated: true, stdoutBase64: "AP8=" });
  await expect(child.exited).resolves.toMatchObject({ aborted: true, stdout: new Uint8Array([0, 255]), exit: { type: "terminated", signal: null } });
});
test("malformed output fails and terminates; invalid final results still release observers", async () => {
  const output = vi.fn(), child = await spawn({ ...options, onOutput: output });
  emit({ type: "processOutput", processId: child.id, stream: "stdout", base64: "AB==" });
  await expect(child.exited).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(output).not.toHaveBeenCalled(); expect(mocks.call.mock.calls.some(([method]) => method === "terminate")).toBe(true);
  exit(child.id, { terminated: "wrong" }); expect(mocks.listeners.size).toBe(0);
  const second = await spawn({ ...options, captureLimitBytes: 0 });
  exit(second.id, { stdoutBase64: "AA==" }); await expect(second.exited).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("runCommand closes input and preserves expected nonzero exit status", async () => {
  mocks.call.mockImplementation(async (method, json) => {
    const { id } = JSON.parse(json);
    if (method === "closeInput") exit(id, { exitCode: 7, stderrBase64: "ZXJyb3I=" });
    return "null";
  });
  const result = await runCommand(options);
  expect(result.exit).toEqual({ type: "exited", code: 7 }); expect(new TextDecoder().decode(result.stderr)).toBe("error");
});
test("invalid options and unsupported capabilities reject before side effects", async () => {
  for (const extra of [{ args: "bad" }, { captureLimitBytes: -1 }, { signal: {} }, { onOutput: true }, { target: { type: "helper", name: "../escape" } }, { target: { type: "command", name: "/bin/cat" } }, { target: { type: "executable", path: "/bin/cat", name: "bad" } }]) {
    await expect(spawn({ ...options, ...extra } as never)).rejects.toBeDefined();
  }
  await expect(spawn({ ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0);
  mocks.platform.OS = "ios"; await expect(spawn(options)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});
