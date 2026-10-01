import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "macos" }, listeners: new Set<(event: any) => void>() }));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: () => ({ call: mocks.call, binaryCall: (method: string, json: string, buffer?: ArrayBuffer, offset?: number, length?: number) => mocks.call(method, json, buffer && new Uint8Array(buffer, offset, length).slice()).then(JSON.parse) }) } }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (listener: (event: any) => void) => { mocks.listeners.add(listener); return { remove: () => { mocks.listeners.delete(listener); } }; } }));
import { spawn, runCommand, resolveCommand } from "../packages/processes/src/index";
const options = { target: { type: "executable" as const, path: "/bin/cat" } };
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function emit(event: any) { for (const listener of mocks.listeners) listener(event); }
function exit(id: string, extra = {}) { emit({ type: "processExit", processId: id, result: { exitCode: 0, terminated: false, terminationSignal: null, stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), timedOut: false, outputTruncated: false, ...extra } }); }
beforeEach(() => { mocks.call.mockReset().mockResolvedValue("null"); mocks.listeners.clear(); mocks.platform.OS = "macos"; });
test("command spawning snapshots arguments and bytes before native resolution", async () => {
  const input = new Uint8Array([0, 255]), args = ["first"], env = { VALUE: "first" };
  const pending = spawn({ target: { type: "command", name: "cat" }, args, env, input, captureLimitBytes: 1 });
  input[0] = 1; args[0] = "changed"; env.VALUE = "changed";
  const child = await pending;
  expect(JSON.parse(mocks.call.mock.calls.at(-1)![1])).toMatchObject({ executable: "cat", command: true, args: ["first"], env: { VALUE: "first" }, captureLimitBytes: 1 });
  expect(mocks.call.mock.calls.at(-1)![2]).toEqual(new Uint8Array([0, 255]));
  exit(child.id);
  await expect(resolveCommand("missing")).resolves.toBeNull();
  mocks.call.mockRejectedValueOnce(Object.assign(Error("Command not found"), { code: "E_NOT_FOUND" }));
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
  await tick(); expect(mocks.call.mock.calls.filter(([method]) => method === "write")).toHaveLength(2);
  await expect(closing).rejects.toMatchObject({ code: "E_NATIVE" }); release(); await one; await two;
  expect(mocks.call.mock.calls.find(([method]) => method === "write")![2]).toEqual(new Uint8Array([0, 255]));
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
  exit(id, { exitCode: 1, terminated: true, stdout: new Uint8Array([0, 255]).buffer });
  await expect(child.exited).resolves.toMatchObject({ aborted: true, stdout: new Uint8Array([0, 255]), exit: { type: "terminated", signal: null } });
});
test("malformed output fails and terminates; invalid final results still release observers", async () => {
  const output = vi.fn(), child = await spawn({ ...options, onOutput: output });
  emit({ type: "processOutput", processId: child.id, stream: "stdout", bytes: "bad" });
  await expect(child.exited).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(output).not.toHaveBeenCalled(); expect(mocks.call.mock.calls.some(([method]) => method === "terminate")).toBe(true);
  exit(child.id, { terminated: "wrong" }); expect(mocks.listeners.size).toBe(0);
  const second = await spawn({ ...options, captureLimitBytes: 0 });
  exit(second.id, { stdout: new Uint8Array([0]).buffer }); await expect(second.exited).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("runCommand closes input and preserves expected nonzero exit status", async () => {
  mocks.call.mockImplementation(async (method, json) => {
    const { id } = JSON.parse(json);
    if (method === "closeInput") exit(id, { exitCode: 7, stderr: new TextEncoder().encode("error").buffer });
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


test("command failure retains both the original error and failed termination", async () => {
  mocks.call.mockImplementation(async method => {
    if (method === "closeInput") throw Error("input failed");
    if (method === "terminate") throw Error("termination failed");
    return "null";
  });
  await expect(runCommand(options)).rejects.toMatchObject({ code: "E_NATIVE", cause: {
    errors: [expect.objectContaining({ message: "input failed" }), expect.objectContaining({ message: "termination failed" })],
  } });
});

test("malformed launch acknowledgement retains a rollback failure", async () => {
  mocks.call.mockImplementation(async method => {
    if (method === "spawn") return "{}";
    if (method === "terminate") throw Error("termination failed");
    return "null";
  });
  await expect(spawn(options)).rejects.toMatchObject({ code: "E_NATIVE", cause: {
    errors: [expect.objectContaining({ code: "E_INVALID_DATA" }), expect.objectContaining({ message: "termination failed" })],
  } });
  expect(mocks.listeners.size).toBe(0);
});
