import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { createAudioPlayer } = vi.hoisted(() => ({ createAudioPlayer: vi.fn() }));
vi.mock("../packages/audio/src/index", () => ({ createAudioPlayer }));
import { useAudioPlayer, type AudioPlayerState, type AudioPlayerHookOptions } from "../packages/audio/src/hooks";

let rendered: any, state: AudioPlayerState;
function Root({ uri = "file:///track", options }: { uri?: string; options?: AudioPlayerHookOptions }) {
  state = useAudioPlayer({ uri }, options); return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turns = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; createAudioPlayer.mockReset();
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  vi.restoreAllMocks();
});

test("Strict Mode and unmount release a player whose creation finishes late", async () => {
  const pending = deferred<any>();
  createAudioPlayer.mockReturnValue(pending.promise);
  await act(async () => { rendered = create(React.createElement(StrictMode, null, React.createElement(Root))); });
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  const signal = createAudioPlayer.mock.calls[0][1].signal;
  await act(async () => { rendered.unmount(); rendered = undefined; });
  expect(signal.aborted).toBe(true);
  const remove = vi.fn(async () => {});
  await act(async () => { pending.resolve({ remove }); await turns(); });
  expect(remove).toHaveBeenCalledOnce();
});

test("replacement waits for pending creation and removal, and rapid changes acquire only the latest source", async () => {
  const firstCreation = deferred<any>(), firstRemoval = deferred<void>();
  const firstRemove = vi.fn(() => firstRemoval.promise), latestRemove = vi.fn(async () => {});
  createAudioPlayer.mockReturnValueOnce(firstCreation.promise).mockResolvedValueOnce({ remove: latestRemove });
  await act(async () => { rendered = create(React.createElement(Root)); });
  await act(async () => { rendered.update(React.createElement(Root, { uri: "file:///second" })); });
  await act(async () => { rendered.update(React.createElement(Root, { uri: "file:///latest" })); });
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);

  await act(async () => { firstCreation.resolve({ remove: firstRemove }); await turns(); });
  expect(firstRemove).toHaveBeenCalledOnce();
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  await act(async () => { firstRemoval.resolve(); await turns(); });
  expect(createAudioPlayer).toHaveBeenCalledTimes(2);
  expect(createAudioPlayer.mock.calls[1][0]).toEqual({ uri: "file:///latest", title: undefined });
  expect(state.status).toBe("ready");
});

test("failed cleanup is reported with its retry handle and later identities can recover", async () => {
  const firstError = vi.fn(), latestError = vi.fn();
  const remove = vi.fn().mockRejectedValueOnce(Error("cleanup one")).mockRejectedValueOnce(Error("cleanup two")).mockResolvedValue(undefined);
  createAudioPlayer.mockResolvedValueOnce({ remove }).mockResolvedValueOnce({ remove: vi.fn(async () => {}) });
  await act(async () => { rendered = create(React.createElement(Root, { options: { onCleanupError: firstError } })); });
  expect(state.status).toBe("ready");

  await act(async () => { rendered.update(React.createElement(Root, { uri: "file:///blocked", options: { onCleanupError: latestError } })); await turns(); });
  expect(remove).toHaveBeenCalledTimes(2);
  expect(firstError).not.toHaveBeenCalled();
  expect(latestError).toHaveBeenCalledTimes(2);
  expect(latestError.mock.calls[0][1]).toEqual({ remove });
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  expect(state).toMatchObject({ status: "error", error: { message: "cleanup two" } });

  await act(async () => { rendered.update(React.createElement(Root, { uri: "file:///recovered", options: { onCleanupError: latestError } })); await turns(); });
  expect(remove).toHaveBeenCalledTimes(3);
  expect(createAudioPlayer).toHaveBeenCalledTimes(2);
  expect(state.status).toBe("ready");
});

test("source changes hide stale players and report load errors through the committed cleanup callback", async () => {
  const firstError = vi.fn(), latestError = vi.fn(), remove = vi.fn().mockRejectedValueOnce(Error("cleanup")).mockResolvedValue(undefined);
  createAudioPlayer.mockResolvedValueOnce({ remove }).mockRejectedValueOnce(Error("load"));
  await act(async () => { rendered = create(React.createElement(Root, { options: { onCleanupError: firstError } })); });
  expect(state.status).toBe("ready");
  await act(async () => { rendered.update(React.createElement(Root, { uri: "file:///next", options: { onCleanupError: latestError } })); await turns(); });
  expect(remove).toHaveBeenCalledTimes(2);
  expect(firstError).not.toHaveBeenCalled();
  expect(latestError).toHaveBeenCalledWith(expect.objectContaining({ message: "cleanup" }), { remove });
  expect(state).toMatchObject({ status: "error", error: { message: "load" } });
});
