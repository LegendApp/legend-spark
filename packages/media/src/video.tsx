import { createElement } from "react";
import type { ViewProps } from "react-native";
import { SparkError, nativeError, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import DesktopVideoView from "./DesktopVideoViewNativeComponent";
import type { Spec } from "./NativeDesktopMedia";
import { call, checkBoolean, checkOptions, checkRange, checkSignal, isNull, isNumber, isRecord, mediaAvailability, requireMedia, uniqueId } from "./shared";
export type { Availability, Subscription } from "@legendapp/spark-desktop-app/src/contracts";

/** An absolute path, or a file, http or https URL. */
export interface VideoSource { uri: string }
/** Options for `createVideoPlayer`. */
export interface VideoPlayerOptions {
  /** Start over at the end instead of stopping. Default false. */
  loop?: boolean;
  muted?: boolean;
  /** 0–1. Default 1. */
  volume?: number;
  /** The rate playback runs at, 0.25–4. Default 1. */
  rate?: number;
  /** How long loading may take once the player exists. Default 15000. */
  loadTimeoutMs?: number;
  /** Aborting while loading removes the player and rejects E_ABORTED. */
  signal?: AbortSignal;
}
/** Seconds throughout. `playing` is the intent to play, also while buffering; `ended`: it stopped at the end. */
export interface VideoStatus {
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  volume: number;
  muted: boolean;
  ended: boolean;
  /** The video's natural size in points; 0 until known. */
  width: number;
  height: number;
  fullscreen: boolean;
  pictureInPicture: boolean;
  error: string | null;
}
/** Changes while a listener is added; each carries the status after it. `seek`: a seek completed. */
export type VideoPlayerEvent =
  | { type: "playingChange"; playing: boolean; status: VideoStatus }
  | { type: "timeUpdate"; currentTime: number; status: VideoStatus }
  | { type: "seek"; currentTime: number; status: VideoStatus }
  | { type: "rateChange"; rate: number; status: VideoStatus }
  | { type: "volumeChange"; volume: number; muted: boolean; status: VideoStatus }
  | { type: "end"; status: VideoStatus }
  | { type: "fullscreenChange"; fullscreen: boolean; status: VideoStatus }
  | { type: "pictureInPictureChange"; pictureInPicture: boolean; status: VideoStatus }
  | { type: "error"; error: string; status: VideoStatus };
/** A loaded video from `createVideoPlayer`; show it with `VideoView`. Commands reject E_CLOSED after `remove`. */
export interface VideoPlayer {
  /** Identifies the player to VideoView. */
  readonly id: string;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Resolves once the seek completes exactly. Later commands wait for it. */
  seekTo(seconds: number): Promise<void>;
  /** 0.25–4; applies now when playing, and to later play(). */
  setRate(rate: number): Promise<void>;
  /** 0–1. */
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setLoop(loop: boolean): Promise<void>;
  getStatus(): Promise<VideoStatus>;
  /** Shows the video in its own fullscreen window; Escape or leaving fullscreen ends it. Resolves once fullscreen. */
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  /**
   * Floats the video of the VideoView that showed the player last. Rejects E_UNAVAILABLE when this Mac does not support
   * picture in picture (getPictureInPictureAvailability) or no VideoView in a window shows the player.
   */
  startPictureInPicture(): Promise<void>;
  stopPictureInPicture(): Promise<void>;
  /** Native observation runs while at least one listener is added. */
  addListener(listener: (event: VideoPlayerEvent) => void): Subscription;
  /** Ends fullscreen and picture in picture, stops playback and releases the player. Idempotent. */
  remove(): Promise<void>;
}
/** How `VideoView` scales the video into its bounds. */
export type VideoContentFit = "contain" | "cover" | "fill";
/** Props for `VideoView`. */
export interface VideoViewProps extends ViewProps {
  /** The player to show; null shows nothing. A player may be shown by several views. */
  player: VideoPlayer | null;
  /** contain (default): letterboxed; cover: fills and crops; fill: stretches. */
  contentFit?: VideoContentFit;
}

/** macOS only. Windows reports `unsupported-platform` (#403). */
export function getVideoAvailability(): Availability { return mediaAvailability(); }

/**
 * Whether this Mac supports picture in picture (AVPictureInPictureController). `host-restriction`: macOS does not
 * support it here. Starting it also needs the player shown in a VideoView.
 */
export async function getPictureInPictureAvailability(): Promise<Availability> {
  const availability = mediaAvailability();
  if (!availability.available) return availability;
  const capabilities = await call(requireMedia("Video"), "videoCapabilities", {}, (value): value is { pictureInPicture: boolean } => isRecord(value) && typeof value.pictureInPicture === "boolean");
  return capabilities.pictureInPicture ? { available: true } : { available: false, reason: "host-restriction" };
}

const STATUS_NUMBERS = ["currentTime", "duration", "rate", "volume", "width", "height"] as const;
const STATUS_FLAGS = ["playing", "muted", "ended", "fullscreen", "pictureInPicture"] as const;
function isVideoStatus(value: unknown): value is VideoStatus {
  return isRecord(value) && STATUS_NUMBERS.every(key => isNumber(value[key]) && (value[key] as number) >= 0) && STATUS_FLAGS.every(key => typeof value[key] === "boolean")
    && (value.volume as number) <= 1 && (value.error === null || typeof value.error === "string");
}

/** The events a status change means, in a stable order. */
function videoEvents(previous: VideoStatus, status: VideoStatus): VideoPlayerEvent[] {
  const events: VideoPlayerEvent[] = [];
  if (status.error !== null && status.error !== previous.error) events.push({ type: "error", error: status.error, status });
  if (status.playing !== previous.playing) events.push({ type: "playingChange", playing: status.playing, status });
  if (status.rate !== previous.rate) events.push({ type: "rateChange", rate: status.rate, status });
  if (status.volume !== previous.volume || status.muted !== previous.muted) events.push({ type: "volumeChange", volume: status.volume, muted: status.muted, status });
  if (status.currentTime !== previous.currentTime) events.push({ type: "timeUpdate", currentTime: status.currentTime, status });
  if (status.ended && !previous.ended) events.push({ type: "end", status });
  if (status.fullscreen !== previous.fullscreen) events.push({ type: "fullscreenChange", fullscreen: status.fullscreen, status });
  if (status.pictureInPicture !== previous.pictureInPicture) events.push({ type: "pictureInPictureChange", pictureInPicture: status.pictureInPicture, status });
  return events;
}

function source(value: unknown): string {
  checkOptions(value, ["uri"], "video source");
  const uri = (value as VideoSource).uri;
  if (typeof uri !== "string" || !uri || uri.includes("\0") || !(uri.startsWith("/") || /^(file|https?):/i.test(uri))) throw new SparkError("E_INVALID_ARGUMENT", "A video source uri is an absolute path or a file, http or https URL");
  return uri;
}

/** Waits for native readiness, bounded by the timeout and the signal. */
async function ready(native: Spec, id: string, timeoutMs: number, signal: AbortSignal | undefined) {
  let deadline: ReturnType<typeof setTimeout> | undefined, abort = () => {};
  try {
    await Promise.race([
      call(native, "videoReady", { id }, (value): value is true => value === true),
      new Promise<never>((_, reject) => {
        abort = () => reject(new SparkError("E_ABORTED", "Video loading was aborted"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        deadline = setTimeout(() => reject(new SparkError("E_TIMEOUT", "Video loading timed out")), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", abort); }
}

/** Loads a video. Resolves once it can play; nothing plays until play(). */
export async function createVideoPlayer(videoSource: VideoSource, options: VideoPlayerOptions = {}): Promise<VideoPlayer> {
  const uri = source(videoSource);
  const checked = checkOptions(options, ["loop", "muted", "volume", "rate", "loadTimeoutMs", "signal"], "video player");
  const loop = checkBoolean(checked.loop, "loop"), muted = checkBoolean(checked.muted, "muted");
  const volume = checkRange(checked.volume, "volume", 0, 1), rate = checkRange(checked.rate, "rate", 0.25, 4);
  const timeoutMs = checkRange(checked.loadTimeoutMs, "loadTimeoutMs", 1, 2147483647) ?? 15000;
  const signal = checkSignal(checked.signal);
  const native = requireMedia("Video");
  if (signal?.aborted) throw new SparkError("E_ABORTED", "Video loading was aborted");
  const id = uniqueId("video");
  const command = (method: string, args: Record<string, unknown> = {}) => call(native, method, { id, ...args }, isNull).then(() => {});
  await call(native, "videoCreate", { id, uri, loop, muted, volume, rate }, isNull);
  try { await ready(native, id, timeoutMs, signal); }
  catch (cause) {
    try { await command("videoRemove"); } catch (cleanup) { throw new SparkError("E_NATIVE", "Video loading and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return playerHandle(id, native, command);
}

function playerHandle(id: string, native: Spec, command: (method: string, args?: Record<string, unknown>) => Promise<void>): VideoPlayer {
  // Seeks and fullscreen and picture in picture changes complete asynchronously; commands complete in order.
  let queue: Promise<unknown> = Promise.resolve(), closing = false, removal: Promise<void> | undefined, removed = false;
  const closed = () => new SparkError("E_CLOSED", "The video player was removed");
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(closed());
    const result = queue.catch(() => {}).then(operation).catch(error => { throw nativeError(error); });
    queue = result;
    return result;
  }
  const run = (method: string, args?: Record<string, unknown>) => enqueue(() => command(method, args));
  const listeners = new Set<(event: VideoPlayerEvent) => void>();
  let subscription: Subscription | undefined, last: VideoStatus | undefined;
  const deliver = (event: DesktopEvent) => {
    if (!isVideoStatus(event.status)) { console.error(new SparkError("E_INVALID_DATA", "Invalid video status")); return; }
    const status = event.status;
    const events: VideoPlayerEvent[] = event.event === "seeked" ? [{ type: "seek", currentTime: status.currentTime, status }] : last ? videoEvents(last, status) : [];
    last = status;
    for (const value of events) for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener(value); } catch (error) { console.error(error); }
    }
  };
  const stopObserving = () => {
    subscription?.remove(); subscription = undefined; last = undefined;
    if (!removed) void command("videoObserve", { enabled: false }).catch(error => { if (!closing) console.error(error); });
  };
  return {
    id,
    play: () => run("videoPlay"),
    pause: () => run("videoPause"),
    async seekTo(seconds) {
      if (!isNumber(seconds) || seconds < 0) throw new SparkError("E_INVALID_ARGUMENT", "A seek position is a finite, nonnegative number of seconds");
      await enqueue(() => call(native, "videoSeek", { id, seconds }, isVideoStatus));
    },
    async setRate(rate) { checkRange(rate, "rate", 0.25, 4); if (rate === undefined) throw new SparkError("E_INVALID_ARGUMENT", "rate is 0.25–4"); await run("videoRate", { rate }); },
    async setVolume(volume) { checkRange(volume, "volume", 0, 1); if (volume === undefined) throw new SparkError("E_INVALID_ARGUMENT", "volume is 0–1"); await run("videoVolume", { volume }); },
    async setMuted(muted) { if (typeof muted !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "muted is a boolean"); await run("videoMuted", { muted }); },
    async setLoop(loop) { if (typeof loop !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "loop is a boolean"); await run("videoLoop", { loop }); },
    getStatus: () => enqueue(() => call(native, "videoStatus", { id }, isVideoStatus)),
    enterFullscreen: () => run("videoFullscreen", { active: true }),
    exitFullscreen: () => run("videoFullscreen", { active: false }),
    startPictureInPicture: () => run("videoPictureInPicture", { active: true }),
    stopPictureInPicture: () => run("videoPictureInPicture", { active: false }),
    addListener(listener) {
      if (closing) throw closed();
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a video player listener");
      const entry = (event: VideoPlayerEvent) => listener(event);
      listeners.add(entry);
      if (!subscription) {
        subscription = onDesktopEvent(deliver, { types: ["videoPlayer"], target: { field: "id", value: id } });
        void command("videoObserve", { enabled: true }).catch(error => { console.error(error); });
      }
      return { remove() { if (listeners.delete(entry) && !listeners.size && subscription) stopObserving(); } };
    },
    remove() {
      if (removed) return Promise.resolve();
      if (removal) return removal;
      closing = true; listeners.clear(); subscription?.remove(); subscription = undefined;
      removal = queue.catch(() => {}).then(() => command("videoRemove")).then(() => { removed = true; }).catch(error => { throw nativeError(error); }).finally(() => { removal = undefined; });
      return removal;
    },
  };
}

const FITS: readonly VideoContentFit[] = ["contain", "cover", "fill"];
/** Shows a player's video (AVPlayerLayer) behind any children. No controls: render them from the player's status. */
export function VideoView({ player, contentFit = "contain", ...props }: VideoViewProps) {
  requireMedia("VideoView");
  if (!FITS.includes(contentFit)) throw new SparkError("E_INVALID_ARGUMENT", "contentFit is contain, cover or fill");
  return createElement(DesktopVideoView, { ...props, playerId: player?.id ?? "", contentFit });
}
