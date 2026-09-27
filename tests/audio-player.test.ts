import { afterEach, expect, test, vi } from "vitest";
import { playerHandle, waitForAudio, validatePlayerOptions, type PlayerBackend } from "../packages/audio/src/player";
import { statusListeners } from "../packages/audio/src/status-listeners";
const status = { playing: false, currentTime: 0, duration: 10, didJustFinish: false, error: null, volume: 1 };
function fixture() {
  const backend: PlayerBackend = { play: vi.fn(async () => {}), pause: vi.fn(async () => {}), seekTo: vi.fn(async () => {}), setVolume: vi.fn(async () => {}), setMetadata: vi.fn(async () => {}), getStatus: vi.fn(async () => ({ ...status })), remove: vi.fn(async () => {}) };
  return { backend, player: playerHandle(backend) };
}
afterEach(() => vi.useRealTimers());

test("player commands reject invalid input asynchronously and snapshot metadata", async () => {
  const { backend, player } = fixture();
  await expect(player.setVolume(NaN)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(player.seekTo(-1)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(backend.setVolume).not.toHaveBeenCalled(); expect(backend.seekTo).not.toHaveBeenCalled();
  const metadata = { title: "Before" }; const pending = player.setMetadata(metadata); metadata.title = "After"; await pending;
  expect(backend.setMetadata).toHaveBeenCalledWith({ title: "Before" });
  await player.setMetadata(null); expect(backend.setMetadata).toHaveBeenLastCalledWith(null); await player.remove();
});

test("removal stops callbacks immediately, waits for commands, joins calls and retries failure", async () => {
  const { backend, player } = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(backend.play).mockImplementationOnce(() => gate);
  vi.mocked(backend.remove).mockRejectedValueOnce(new Error("busy"));
  const playing = player.play();
  const listener = vi.fn(); player.addListener("playbackStatusUpdate", listener);
  const removal = player.remove(); expect(player.remove()).toBe(removal);
  expect(backend.remove).not.toHaveBeenCalled();
  await expect(player.pause()).rejects.toMatchObject({ code: "E_CLOSED" });
  release(); await playing; await expect(removal).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(listener).not.toHaveBeenCalled();
  await player.remove(); await player.remove(); expect(backend.remove).toHaveBeenCalledTimes(2);
});

test("status shape is validated and a failed command does not poison subsequent work", async () => {
  const { backend, player } = fixture();
  vi.mocked(backend.getStatus).mockResolvedValueOnce({ ...status, volume: 2 });
  await expect(player.getStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(await player.getStatus()).toEqual(status);
  vi.mocked(backend.play).mockRejectedValueOnce(new Error("decode"));
  await expect(player.play()).rejects.toMatchObject({ code: "E_NATIVE" });
  await player.pause(); await player.remove();
});

test("readiness timeout and abort stop polling and remove signal listeners", async () => {
  vi.useFakeTimers(); const ready = vi.fn(async () => false);
  const timed = expect(waitForAudio(ready, { loadTimeoutMs: 75 })).rejects.toMatchObject({ code: "E_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(75); await timed;
  const count = ready.mock.calls.length; await vi.advanceTimersByTimeAsync(1000); expect(ready).toHaveBeenCalledTimes(count);
  const controller = new AbortController(); const removed = vi.spyOn(controller.signal, "removeEventListener");
  const aborted = expect(waitForAudio(ready, { signal: controller.signal })).rejects.toMatchObject({ code: "E_ABORTED" });
  controller.abort(); await aborted; expect(removed).toHaveBeenCalledWith("abort", expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
});

test("readiness succeeds once and rejects invalid timing and already-aborted signals", async () => {
  vi.useFakeTimers(); const ready = vi.fn(async () => true);
  await waitForAudio(ready, {}); expect(ready).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  for (const options of [{ loadTimeoutMs: 0 }, { loadTimeoutMs: Infinity }, { unknown: true }]) expect(() => validatePlayerOptions(options as never)).toThrow();
  const controller = new AbortController(); controller.abort(); expect(() => validatePlayerOptions({ signal: controller.signal })).toThrow();
});

test("removing a status callback during delivery prevents that callback from running", async () => {
  let finish!: (value: typeof status) => void;
  const listeners = statusListeners(() => new Promise(resolve => { finish = resolve; }));
  let second: {remove(): void}; const received: string[] = [];
  listeners.add(() => { received.push("first"); second.remove(); });
  second = listeners.add(() => { received.push("second"); });
  finish(status); await Promise.resolve(); expect(received).toEqual(["first"]); listeners.close();
});
