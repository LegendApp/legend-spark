import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { call, listeners } = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(value: unknown) => void>() }));
vi.mock("react-native", () => ({ NativeEventEmitter: class { addListener(_name: string, listener: (value: unknown) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; } } }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: { call } }));
import { createAudioPlayer } from "../packages/audio/src/desktop";
beforeEach(() => { listeners.clear(); call.mockReset(); call.mockImplementation(async (method: string) => method === "awaitReady" ? "true" : "null"); });
afterEach(() => vi.useRealTimers());
test("desktop player validates transport readiness and awaits failed-load cleanup", async () => {
  let release!: () => void;
  call.mockImplementation(async (method: string) => method === "awaitReady" ? "123" : method === "remove" ? new Promise(resolve => { release = () => resolve("null"); }) : "null");
  let settled = false;
  const pending = createAudioPlayer({ uri: "/track.wav" }).finally(() => { settled = true; });
  const rejected = expect(pending).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(settled).toBe(false);
  release(); await rejected;
});
test("aborted allocation disposes the late-created player before rejecting", async () => {
  const controller = new AbortController(); let release!: () => void;
  call.mockImplementation(async (method: string) => method === "create" ? new Promise(resolve => { release = () => resolve("null"); }) : method === "awaitReady" ? "true" : "null");
  const result = expect(createAudioPlayer({ uri: "/track.wav" }, { signal: controller.signal })).rejects.toMatchObject({ code: "E_ABORTED" });
  controller.abort(); release(); await result;
  expect(call.mock.calls.map(args => args[0])).toContain("remove");
});
test("unknown source properties and aborted input never allocate", async () => {
  await expect(createAudioPlayer({ uri: "/track.wav", backend: {} } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  const controller = new AbortController(); controller.abort();
  await expect(createAudioPlayer({ uri: "/track.wav" }, { signal: controller.signal })).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(call).not.toHaveBeenCalled();
});
test("desktop commands reject malformed results and retry removal", async () => {
  const player = await createAudioPlayer({ uri: "/track.wav" });
  call.mockResolvedValueOnce("true"); await expect(player.play()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  call.mockRejectedValueOnce(new Error("bridge")); await expect(player.remove()).rejects.toMatchObject({ code: "E_NATIVE" });
  await player.remove();
});

test("desktop status observers use native events and a shared native stream without polling", async () => {
  vi.useFakeTimers();
  const player = await createAudioPlayer({ uri: "/track.wav" });
  const id = JSON.parse(call.mock.calls[0][1]).id;
  const first = vi.fn(), second = vi.fn();
  const a = player.addListener("playbackStatusUpdate", first), b = player.addListener("playbackStatusUpdate", second);
  await Promise.resolve();
  expect(call.mock.calls.filter(args => args[0] === "statusUpdates")).toHaveLength(1);
  const value = { playing: true, currentTime: 1, duration: 10, volume: 1, didJustFinish: false, error: null };
  for (const listener of listeners) listener({ id, value });
  expect(first).toHaveBeenCalledWith(value); expect(second).toHaveBeenCalledWith(value);
  const count = call.mock.calls.length; await vi.advanceTimersByTimeAsync(2000);
  expect(call).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  a.remove(); expect(listeners.size).toBe(1);
  b.remove(); expect(listeners.size).toBe(0);
  const updates = call.mock.calls.filter(args => args[0] === "statusUpdates");
  expect(JSON.parse(updates.at(-1)![1]).enabled).toBe(false);
  await player.remove();
});

test("desktop waits for one native readiness promise and timeout disposes the allocation", async () => {
  vi.useFakeTimers(); let loaded!: () => void;
  call.mockImplementation((method: string) => method === "awaitReady" ? new Promise(resolve => { loaded = () => resolve("true"); }) : Promise.resolve("null"));
  const pending = createAudioPlayer({ uri: "/track.wav" }, { loadTimeoutMs: 2000 });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(loaded).toBeTypeOf("function");
  await vi.advanceTimersByTimeAsync(1000); expect(call.mock.calls.filter(args => args[0] === "awaitReady")).toHaveLength(1);
  loaded(); const player = await pending; await player.remove(); expect(vi.getTimerCount()).toBe(0);
  const timed = expect(createAudioPlayer({ uri: "/track.wav" }, { loadTimeoutMs: 100 })).rejects.toMatchObject({ code: "E_TIMEOUT" });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(100); await timed;
  expect(call.mock.calls.at(-1)?.[0]).toBe("remove"); loaded(); expect(vi.getTimerCount()).toBe(0);
});
