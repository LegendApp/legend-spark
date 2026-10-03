import { afterEach, expect, test, vi } from "vitest";
const { expo, mode } = vi.hoisted(() => ({ expo: { isLoaded: true, currentStatus: { playbackState: "readyToPlay", playing: false, currentTime: 0, duration: 10 }, volume: 1,
  addListener: vi.fn((_event: string, _listener: (status: any) => void) => ({ remove: vi.fn() })), setActiveForLockScreen: vi.fn(), updateLockScreenMetadata: vi.fn(), play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(async () => {}), clearLockScreenControls: vi.fn(), remove: vi.fn() }, mode: vi.fn(async () => {}) }));
vi.mock("expo-audio", () => ({ createAudioPlayer: () => expo, setAudioModeAsync: mode }));
vi.mock("react-native", () => ({ NativeEventEmitter: class {} }));
vi.mock("../packages/audio/src/NativeSparkAudio", () => ({ default: null }));
import { createAudioPlayer as createMobile } from "../packages/audio/src/mobile";
import { createAudioPlayer as createWeb } from "../packages/audio/src/index.web";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); expo.currentStatus.playbackState = "readyToPlay"; });

function browserAudio() {
  const events = new EventTarget();
  const listenerCounts = new Map<string, number>();
  let currentTime = 0, seeking = false, listenersAtAssignment: string[] = [];
  const audio = {
    readyState: 1, error: null as null | { message: string }, preload: "", paused: true, duration: 10, ended: false, volume: 1,
    pause: vi.fn(), play: vi.fn(async () => {}), load: vi.fn(), removeAttribute: vi.fn(),
    get currentTime() { return currentTime; },
    set currentTime(value: number) { listenersAtAssignment = [...listenerCounts.keys()].filter(key => listenerCounts.get(key)); currentTime = value; seeking = true; },
    get seeking() { return seeking; },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listenerCounts.set(type, (listenerCounts.get(type) ?? 0) + 1);
      events.addEventListener(type, listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listenerCounts.set(type, Math.max(0, (listenerCounts.get(type) ?? 0) - 1));
      events.removeEventListener(type, listener);
    },
  };
  return {
    audio,
    dispatch(type: string) { events.dispatchEvent(new Event(type)); },
    completeSeek() { seeking = false; events.dispatchEvent(new Event("seeked")); },
    listenerCount(type: string) { return listenerCounts.get(type) ?? 0; },
    listenersAtAssignment() { return listenersAtAssignment; },
  };
}

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

test("mobile forwards existing Expo playback events without status reads or timers", async () => {
  vi.useFakeTimers();
  try {
    const player = await createMobile({ uri: "https://example.com/audio.wav" });
    const listener = vi.fn(); const registration = player.addListener("playbackStatusUpdate", listener);
    expect(expo.addListener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    const notify = expo.addListener.mock.calls[0][1] as (status: unknown) => void;
    notify({ playing: true, currentTime: 12, duration: 30, didJustFinish: true, playbackState: "readyToPlay" });
    expect(listener).toHaveBeenCalledWith({ playing: true, currentTime: 12, duration: 30, volume: 1, didJustFinish: true, error: null });
    await vi.advanceTimersByTimeAsync(2000); expect(listener).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    registration.remove(); notify({ ...expo.currentStatus, didJustFinish: false }); expect(listener).toHaveBeenCalledTimes(1);
    await player.remove();
  } finally { vi.useRealTimers(); }
});

test("mobile load readiness uses its existing Expo subscription", async () => {
  vi.useFakeTimers(); expo.isLoaded = false;
  try {
    const pending = createMobile({ uri: "https://example.com/audio.wav" });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(expo.addListener).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); expect(vi.getTimerCount()).toBe(1);
    expo.isLoaded = true; expo.addListener.mock.calls[0][1](expo.currentStatus);
    const player = await pending; expect(vi.getTimerCount()).toBe(0); await player.remove();
  } finally { expo.isLoaded = true; vi.useRealTimers(); }
});

test("browser creation waits for metadata and releases on load failure", async () => {
  const events = new EventTarget();
  const audio = { readyState: 0, error: null as null | {message: string}, preload: "", paused: true, currentTime: 0, duration: 10, ended: false, volume: 1, pause: vi.fn(), play: vi.fn(async () => {}), load: vi.fn(), removeAttribute: vi.fn(), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  vi.stubGlobal("Audio", class { constructor() { return audio; } });
  vi.stubGlobal("navigator", {});
  let ready = false;
  const pending = createWeb({ uri: "https://example.com/audio.wav" }).then(player => { ready = true; return player; });
  await Promise.resolve(); expect(ready).toBe(false); audio.readyState = 1; events.dispatchEvent(new Event("loadedmetadata"));
  const player = await pending;
  const status = vi.fn(), registration = player.addListener("playbackStatusUpdate", status);
  audio.currentTime = 3; events.dispatchEvent(new Event("timeupdate"));
  expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 3 }));
  const count = status.mock.calls.length; registration.remove();
  events.dispatchEvent(new Event("timeupdate")); expect(status).toHaveBeenCalledTimes(count);
  await player.remove(); expect(audio.removeAttribute).toHaveBeenCalledWith("src");
  audio.readyState = 0; audio.error = { message: "decode error" };
  await expect(createWeb({ uri: "https://example.com/bad.wav" })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(audio.removeAttribute).toHaveBeenCalledTimes(2);
});

test("browser seek installs listeners before assignment and serializes later commands", async () => {
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  const player = await createWeb({ uri: "https://example.com/audio.wav" });
  const seek = player.seekTo(4);
  const pause = player.pause();
  await Promise.resolve(); await Promise.resolve();
  expect(media.listenersAtAssignment()).toEqual(expect.arrayContaining(["seeked", "error", "emptied"]));
  expect(media.audio.currentTime).toBe(4);
  expect(media.audio.pause).not.toHaveBeenCalled();
  media.dispatch("seeked");
  await Promise.resolve();
  expect(media.audio.pause).not.toHaveBeenCalled();
  media.completeSeek();
  await Promise.all([seek, pause]);
  expect(media.audio.pause).toHaveBeenCalledTimes(1);
  expect(media.listenerCount("seeked")).toBe(0);
  await player.remove();
});

test("browser seek errors on media failure and assignment failure and clears listeners", async () => {
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  const player = await createWeb({ uri: "https://example.com/audio.wav" });
  const seek = player.seekTo(5);
  const failedSeek = expect(seek).rejects.toMatchObject({ code: "E_NATIVE", message: "decode failed" });
  await Promise.resolve(); await Promise.resolve();
  media.audio.error = { message: "decode failed" };
  media.dispatch("error");
  await failedSeek;
  expect(media.listenerCount("seeked")).toBe(0);

  media.audio.error = null;
  Object.defineProperty(media.audio, "currentTime", { set() { throw new Error("seek assignment failed"); }, get() { return 0; } });
  await expect(player.seekTo(2)).rejects.toMatchObject({ code: "E_NATIVE", message: "Failed to seek browser audio" });
  expect(media.listenerCount("seeked")).toBe(0);
  await player.remove();
});

test("browser seek no-ops at the current position and removal cancels a pending seek", async () => {
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  const player = await createWeb({ uri: "https://example.com/audio.wav" });
  await player.seekTo(0);
  expect(media.listenerCount("seeked")).toBe(0);
  const seek = player.seekTo(8);
  const canceledSeek = expect(seek).rejects.toMatchObject({ code: "E_CLOSED" });
  await Promise.resolve(); await Promise.resolve();
  const removal = player.remove();
  await canceledSeek;
  await removal;
  expect(media.listenerCount("seeked")).toBe(0);
  expect(media.audio.removeAttribute).toHaveBeenCalledWith("src");
});

test("browser seek rejects when the media source is removed externally", async () => {
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  const player = await createWeb({ uri: "https://example.com/audio.wav" });
  const seek = player.seekTo(8);
  const removedSeek = expect(seek).rejects.toMatchObject({ code: "E_CLOSED" });
  await Promise.resolve(); await Promise.resolve();
  media.dispatch("emptied");
  await removedSeek;
  expect(media.listenerCount("seeked")).toBe(0);
  await player.remove();
});

test("browser removal closes same-turn and queued seeks before they can start", async () => {
  vi.useFakeTimers();
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  try {
    const player = await createWeb({ uri: "https://example.com/audio.wav" });
    const first = player.seekTo(7);
    const second = player.seekTo(8);
    const firstRejected = expect(first).rejects.toMatchObject({ code: "E_CLOSED" });
    const secondRejected = expect(second).rejects.toMatchObject({ code: "E_CLOSED" });
    const removal = player.remove();
    await Promise.all([firstRejected, secondRejected, removal]);
    expect(media.audio.currentTime).toBe(0);
    expect(media.listenerCount("seeked")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("browser removal cancels an active seek and closes later accepted seeks", async () => {
  vi.useFakeTimers();
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  try {
    const player = await createWeb({ uri: "https://example.com/audio.wav" });
    const active = player.seekTo(7);
    const activeRejected = expect(active).rejects.toMatchObject({ code: "E_CLOSED" });
    await Promise.resolve(); await Promise.resolve();
    const later = player.seekTo(8);
    const laterRejected = expect(later).rejects.toMatchObject({ code: "E_CLOSED" });
    const removal = player.remove();
    await Promise.all([activeRejected, laterRejected, removal]);
    expect(media.audio.currentTime).toBe(7);
    expect(media.listenerCount("seeked")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("browser seeks have a bounded timeout when the media element never completes", async () => {
  vi.useFakeTimers();
  const media = browserAudio();
  vi.stubGlobal("Audio", class { constructor() { return media.audio; } });
  vi.stubGlobal("navigator", {});
  try {
    const player = await createWeb({ uri: "https://example.com/audio.wav" });
    const seek = player.seekTo(6);
    const timedOutSeek = expect(seek).rejects.toMatchObject({ code: "E_TIMEOUT" });
    await Promise.resolve(); await Promise.resolve();
    expect(media.listenerCount("seeked")).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await timedOutSeek;
    await player.remove();
    expect(media.listenerCount("seeked")).toBe(0);
  } finally { vi.useRealTimers(); }
});
