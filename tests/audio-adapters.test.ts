import { afterEach, expect, test, vi } from "vitest";
const { expo, mode } = vi.hoisted(() => ({ expo: { isLoaded: true, currentStatus: { playbackState: "readyToPlay", playing: false, currentTime: 0, duration: 10 }, volume: 1,
  addListener: vi.fn(() => ({ remove: vi.fn() })), setActiveForLockScreen: vi.fn(), updateLockScreenMetadata: vi.fn(), play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(async () => {}), clearLockScreenControls: vi.fn(), remove: vi.fn() }, mode: vi.fn(async () => {}) }));
vi.mock("expo-audio", () => ({ createAudioPlayer: () => expo, setAudioModeAsync: mode }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: null }));
import { createAudioPlayer as createMobile } from "../packages/audio/src/mobile";
import { createAudioPlayer as createWeb } from "../packages/audio/src/index.web";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); expo.currentStatus.playbackState = "readyToPlay"; });

test("mobile adapts ready player status, metadata clearing and cleanup", async () => {
  const player = await createMobile({ uri: "https://example.com/audio.wav", title: "Track" });
  expect(expo.setActiveForLockScreen).toHaveBeenCalledWith(true, { title: "Track" });
  expect(await player.getStatus()).toMatchObject({ duration: 10, volume: 1, error: null });
  await player.setMetadata(null); expect(expo.updateLockScreenMetadata).toHaveBeenCalledWith({});
  await player.remove(); await player.remove(); expect(expo.remove).toHaveBeenCalledTimes(1);
});

test("mobile load failures release both listener and player", async () => {
  expo.currentStatus.playbackState = "error";
  await expect(createMobile({ uri: "https://example.com/bad.wav" })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(expo.addListener.mock.results[0]?.value.remove).toHaveBeenCalled(); expect(expo.remove).toHaveBeenCalledTimes(1);
});

test("browser creation waits for metadata and releases on load failure", async () => {
  const audio = { readyState: 0, error: null as null | {message: string}, preload: "", paused: true, currentTime: 0, duration: 10, ended: false, volume: 1, pause: vi.fn(), play: vi.fn(async () => {}), load: vi.fn(), removeAttribute: vi.fn() };
  vi.stubGlobal("Audio", class { constructor() { return audio; } });
  vi.stubGlobal("navigator", {});
  let ready = false;
  const pending = createWeb({ uri: "https://example.com/audio.wav" }).then(player => { ready = true; return player; });
  await Promise.resolve(); expect(ready).toBe(false); audio.readyState = 1;
  const player = await pending; await player.remove(); expect(audio.removeAttribute).toHaveBeenCalledWith("src");
  audio.readyState = 0; audio.error = { message: "decode error" };
  await expect(createWeb({ uri: "https://example.com/bad.wav" })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(audio.removeAttribute).toHaveBeenCalledTimes(2);
});
