import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/video against a mocked bridge: validation, wire shapes, readiness, command order, typed events and removal.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let call = (method: string, args: string): Promise<string> => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(reply(method, JSON.parse(args))).then(value => JSON.stringify(value)); };
const record = call;
const platform = { OS: "macos" };
const media = { call: (method: string, args: string) => call(method, args) };
const app = { call: () => Promise.resolve("null"), addListener() {}, removeListeners() {} };
const listeners: ((event: unknown) => void)[] = [];
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { listeners.push(listener); return { remove() { listeners.splice(listeners.indexOf(listener), 1); } }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: (name: string) => name === "NativeDesktopMedia" ? media : app }, NativeEventEmitter }));
vi.doMock("react-native/Libraries/Utilities/codegenNativeComponent", () => ({ default: () => "DesktopVideoView" }));
const video = await import("../packages/media/src/video.tsx");
const emit = (event: object) => [...listeners].forEach(listener => listener(event));
const STATUS = { playing: false, currentTime: 0, duration: 3, rate: 1, volume: 1, muted: false, ended: false, width: 160, height: 90, fullscreen: false, pictureInPicture: false, error: null };
const ready = (method: string) => method === "videoReady" ? true : method === "videoSeek" || method === "videoStatus" ? STATUS : method === "videoCapabilities" ? { pictureInPicture: true } : null;
beforeEach(() => { platform.OS = "macos"; call = record; reply = ready; calls.length = 0; });

test("availability reports macOS and other platforms; unsupported and invalid calls reject before native work", async () => {
  expect(video.getVideoAvailability()).toEqual({ available: true });
  expect(await video.getPictureInPictureAvailability()).toEqual({ available: true });
  reply = () => ({ pictureInPicture: false });
  expect(await video.getPictureInPictureAvailability()).toEqual({ available: false, reason: "host-restriction" });
  calls.length = 0;
  platform.OS = "windows";
  expect(video.getVideoAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(await video.getPictureInPictureAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(() => video.VideoView({ player: null })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  platform.OS = "macos";
  await expect(video.createVideoPlayer({ uri: "clip.mp4" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(video.createVideoPlayer({ uri: "ftp://host/clip.mp4" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(video.createVideoPlayer({ uri: "/clip.mp4", title: "x" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" }, { autoplay: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" }, { rate: 8 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" }, { volume: -1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const aborted = new AbortController(); aborted.abort();
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" }, { signal: aborted.signal })).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(calls).toEqual([]);
});

test("a player is created, waits for readiness, and maps every command to its native operation in order", async () => {
  const player = await video.createVideoPlayer({ uri: "file:///tmp/clip.mp4" }, { loop: true, muted: true, volume: 0.5, rate: 2 });
  expect(calls.map(entry => entry.method)).toEqual(["videoCreate", "videoReady"]);
  expect(calls[0]!.args).toEqual({ id: player.id, uri: "file:///tmp/clip.mp4", loop: true, muted: true, volume: 0.5, rate: 2 });
  calls.length = 0;
  await Promise.all([player.play(), player.seekTo(1.5), player.setRate(0.5), player.setVolume(0.25), player.setMuted(false), player.setLoop(false), player.pause(),
    player.enterFullscreen(), player.exitFullscreen(), player.startPictureInPicture(), player.stopPictureInPicture()]);
  expect(calls.map(entry => [entry.method, entry.args])).toEqual([
    ["videoPlay", { id: player.id }], ["videoSeek", { id: player.id, seconds: 1.5 }], ["videoRate", { id: player.id, rate: 0.5 }], ["videoVolume", { id: player.id, volume: 0.25 }],
    ["videoMuted", { id: player.id, muted: false }], ["videoLoop", { id: player.id, loop: false }], ["videoPause", { id: player.id }],
    ["videoFullscreen", { id: player.id, active: true }], ["videoFullscreen", { id: player.id, active: false }],
    ["videoPictureInPicture", { id: player.id, active: true }], ["videoPictureInPicture", { id: player.id, active: false }],
  ]);
  expect(await player.getStatus()).toEqual(STATUS);
  await expect(player.seekTo(-1)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(player.setRate(0.1)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(player.setVolume(Number.NaN)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(player.setMuted(1 as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  reply = method => method === "videoStatus" ? { ...STATUS, volume: 2 } : null;
  await expect(player.getStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("a later command waits for a pending seek; native errors keep their code", async () => {
  const player = await video.createVideoPlayer({ uri: "/clip.mp4" });
  let finishSeek!: () => void;
  const order: string[] = [];
  reply = method => {
    order.push(method);
    if (method === "videoSeek") return new Promise(resolve => { finishSeek = () => resolve(STATUS); });
    if (method === "videoPictureInPicture") return Promise.reject(Object.assign(new Error("Picture in picture needs the player shown in a VideoView"), { code: "E_UNAVAILABLE" }));
    return null;
  };
  const seek = player.seekTo(2);
  const play = player.play();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(order).toEqual(["videoSeek"]);
  finishSeek();
  await Promise.all([seek, play]);
  expect(order).toEqual(["videoSeek", "videoPlay"]);
  await expect(player.startPictureInPicture()).rejects.toMatchObject({ code: "E_UNAVAILABLE", message: expect.stringContaining("VideoView") });
});

test("loading that times out or is aborted removes the native player", async () => {
  reply = method => method === "videoReady" ? new Promise(() => {}) : null;
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" }, { loadTimeoutMs: 20 })).rejects.toMatchObject({ code: "E_TIMEOUT" });
  expect(calls.map(entry => entry.method)).toEqual(["videoCreate", "videoReady", "videoRemove"]);
  calls.length = 0;
  const controller = new AbortController();
  const loading = video.createVideoPlayer({ uri: "/clip.mp4" }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await expect(loading).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(calls.map(entry => entry.method)).toEqual(["videoCreate", "videoReady", "videoRemove"]);
  calls.length = 0;
  reply = method => method === "videoReady" ? Promise.reject(Object.assign(new Error("The video could not be loaded"), { code: "E_NATIVE" })) : null;
  await expect(video.createVideoPlayer({ uri: "/clip.mp4" })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(calls.at(-1)!.method).toBe("videoRemove");
});

test("listeners get typed events from status changes and completed seeks; native observation runs only while listened", async () => {
  const player = await video.createVideoPlayer({ uri: "/clip.mp4" });
  calls.length = 0;
  const events: any[] = [];
  const subscription = player.addListener(event => events.push(event));
  const second = player.addListener(() => {});
  expect(calls.map(entry => [entry.method, entry.args])).toEqual([["videoObserve", { id: player.id, enabled: true }]]);
  const status = (changes: object, event = "status", id = player.id) => emit({ type: "videoPlayer", id, event, status: { ...STATUS, ...changes } });
  status({});                                   // The first status is the baseline.
  status({ playing: true });
  status({ playing: true, currentTime: 0.25 });
  status({ playing: true, currentTime: 0.25, rate: 2, volume: 0.5 });
  status({ playing: false, currentTime: 3, rate: 2, volume: 0.5, muted: true, ended: true });
  status({ playing: false, currentTime: 1, rate: 2, volume: 0.5, muted: true }, "seeked");
  status({ playing: false, currentTime: 1, rate: 2, volume: 0.5, muted: true, fullscreen: true, pictureInPicture: true, error: "Decoding failed" });
  status({ playing: true }, "status", "video-other");
  emit({ type: "videoPlayer", id: player.id, event: "status", status: { ...STATUS, volume: 9 } });
  expect(events.map(event => event.type)).toEqual(["playingChange", "timeUpdate", "rateChange", "volumeChange", "playingChange", "volumeChange", "timeUpdate", "end",
    "seek", "error", "fullscreenChange", "pictureInPictureChange"]);
  expect(events[0]).toMatchObject({ type: "playingChange", playing: true, status: { playing: true } });
  expect(events[3]).toMatchObject({ type: "volumeChange", volume: 0.5, muted: false });
  expect(events[8]).toMatchObject({ type: "seek", currentTime: 1 });
  expect(events[9]).toMatchObject({ type: "error", error: "Decoding failed" });
  subscription.remove();
  expect(calls.filter(entry => entry.method === "videoObserve")).toHaveLength(1);
  second.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls.filter(entry => entry.method === "videoObserve").at(-1)!.args).toEqual({ id: player.id, enabled: false });
  const count = events.length;
  status({ playing: true });
  expect(events).toHaveLength(count);
  expect(() => player.addListener("x" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("removal waits for accepted commands, is idempotent, and closes the player", async () => {
  const player = await video.createVideoPlayer({ uri: "/clip.mp4" });
  calls.length = 0;
  const events: unknown[] = [];
  player.addListener(event => events.push(event));
  const play = player.play();
  const [first, second] = [player.remove(), player.remove()];
  await Promise.all([play, first, second]);
  expect(calls.map(entry => entry.method)).toEqual(["videoObserve", "videoPlay", "videoRemove"]);
  await player.remove();
  expect(calls.filter(entry => entry.method === "videoRemove")).toHaveLength(1);
  await expect(player.play()).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(() => player.addListener(() => {})).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  emit({ type: "videoPlayer", id: player.id, event: "status", status: { ...STATUS, playing: true } });
  expect(events).toEqual([]);
  // A failed removal can be retried.
  const other = await video.createVideoPlayer({ uri: "/clip.mp4" });
  reply = method => method === "videoRemove" ? Promise.reject(Object.assign(new Error("busy"), { code: "E_BUSY" })) : null;
  await expect(other.remove()).rejects.toMatchObject({ code: "E_BUSY" });
  reply = () => null;
  await expect(other.remove()).resolves.toBeUndefined();
});

test("VideoView names its player and validates contentFit", async () => {
  const player = await video.createVideoPlayer({ uri: "/clip.mp4" });
  expect(video.VideoView({ player, contentFit: "cover", testID: "clip" })).toMatchObject({ type: "DesktopVideoView", props: { playerId: player.id, contentFit: "cover", testID: "clip" } });
  expect(video.VideoView({ player: null })).toMatchObject({ props: { playerId: "", contentFit: "contain" } });
  expect(() => video.VideoView({ player, contentFit: "stretch" as never })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});
