import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { createAudioPlayer } = vi.hoisted(() => ({ createAudioPlayer: vi.fn() }));
vi.mock("../packages/audio/src/index", () => ({ createAudioPlayer }));
import { useAudioPlayer, type AudioPlayerState, type AudioPlayerHookOptions } from "../packages/audio/src/hooks";
let rendered: any, state: AudioPlayerState;
function Root({ uri = "file:///track", options }: { uri?: string; options?: AudioPlayerHookOptions }) { state = useAudioPlayer({ uri }, options); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; createAudioPlayer.mockReset();
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => { if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); vi.restoreAllMocks(); });
test("Strict Mode aborts retired creation and releases players arriving after unmount", async () => {
  const pending: ((player: any) => void)[] = [];
  createAudioPlayer.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(Root))); });
  expect(createAudioPlayer).toHaveBeenCalledTimes(2); expect(createAudioPlayer.mock.calls[0][1].signal.aborted).toBe(true); expect(state.status).toBe("loading");
  const first = { remove: vi.fn(async () => {}) }, second = { remove: vi.fn(async () => {}) };
  await act(async () => pending[0](first)); expect(first.remove).toHaveBeenCalledTimes(1); expect(state.status).toBe("loading");
  await act(async () => rendered.unmount()); expect(createAudioPlayer.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => pending[1](second)); expect(second.remove).toHaveBeenCalledTimes(1);
});
test("source changes hide stale players, report load errors and use the latest cleanup callback", async () => {
  const firstError = vi.fn(), latestError = vi.fn(), remove = vi.fn(async () => { throw Error("cleanup"); });
  createAudioPlayer.mockResolvedValueOnce({ remove }).mockRejectedValueOnce(Error("load"));
  await act(async () => { rendered = create(React.createElement(Root, { options: { onCleanupError: firstError } })); }); expect(state.status).toBe("ready");
  await act(async () => rendered.update(React.createElement(Root, { uri: "file:///next", options: { onCleanupError: latestError } })));
  expect(remove).toHaveBeenCalledTimes(1); expect(firstError).not.toHaveBeenCalled(); expect(latestError).toHaveBeenCalledWith(expect.objectContaining({ message: "cleanup" }), { remove });
  expect(state).toMatchObject({ status: "error", error: { message: "load" } });
});
