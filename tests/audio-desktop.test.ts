import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: { call } }));
import { createAudioPlayer } from "../packages/audio/src/desktop";
beforeEach(() => { call.mockReset(); call.mockImplementation(async (method: string) => method === "ready" ? "true" : "null"); });
afterEach(() => vi.useRealTimers());
test("desktop player validates transport readiness and awaits failed-load cleanup", async () => {
  let release!: () => void;
  call.mockImplementation(async (method: string) => method === "ready" ? "123" : method === "remove" ? new Promise(resolve => { release = () => resolve("null"); }) : "null");
  let settled = false;
  const pending = createAudioPlayer({ uri: "/track.wav" }).finally(() => { settled = true; });
  const rejected = expect(pending).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function")); expect(settled).toBe(false);
  release(); await rejected;
});
test("aborted allocation disposes the late-created player before rejecting", async () => {
  const controller = new AbortController(); let release!: () => void;
  call.mockImplementation(async (method: string) => method === "create" ? new Promise(resolve => { release = () => resolve("null"); }) : method === "ready" ? "true" : "null");
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
