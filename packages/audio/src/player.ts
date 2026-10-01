import { SparkError, nativeError } from "@legendapp/spark-desktop-app/src/contracts";
import { validateMetadata, validateVolume } from "./media-types";
import { statusListeners } from "./status-listeners";
import { validateTime, type AudioPlayer, type AudioPlayerOptions, type AudioStatus } from "./types";

export type PlayerBackend = Omit<AudioPlayer, "addListener"> & { addStatusListener(listener: (status: AudioStatus) => void): ReturnType<AudioPlayer["addListener"]> };
export function validAudioStatus(value: unknown): value is AudioStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as AudioStatus;
  return typeof status.playing === "boolean" && typeof status.didJustFinish === "boolean" && (status.error === null || typeof status.error === "string") && [status.currentTime, status.duration, status.volume].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) && status.volume <= 1;
}
/** Command completion is ordered: AVPlayer seeks can finish after later native submissions.
 * The queue is required for that guarantee; native status events do not enter it. */
export function playerHandle(backend: PlayerBackend): AudioPlayer {
  let queue: Promise<unknown> = Promise.resolve();
  let closing = false;
  let removed = false;
  let removal: Promise<void> | undefined;
  const alive = () => { if (closing) throw new SparkError("E_CLOSED", "Audio player is closing or removed"); };
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new SparkError("E_CLOSED", "Audio player is closing or removed"));
    const result = queue.catch(() => {}).then(operation).catch(error => { throw nativeError(error); });
    queue = result; return result;
  }
  const read = () => enqueue(async () => {
    const status = await backend.getStatus();
    if (!validAudioStatus(status)) throw new SparkError("E_INVALID_DATA", "Invalid audio status");
    return status;
  });
  const listeners = statusListeners(listener => backend.addStatusListener(status => {
    if (!validAudioStatus(status)) { console.error(new SparkError("E_INVALID_DATA", "Invalid audio status")); return; }
    listener(status);
  }));
  return {
    async setVolume(volume) { validateVolume(volume); await enqueue(() => backend.setVolume(volume)); },
    async setMetadata(metadata) {
      if (metadata !== null) validateMetadata(metadata);
      const snapshot = metadata === null ? null : { ...metadata };
      await enqueue(() => backend.setMetadata(snapshot));
    },
    addListener(event, listener) {
      alive();
      if (event !== "playbackStatusUpdate" || typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a playbackStatusUpdate listener");
      return listeners.add(listener);
    },
    play: () => enqueue(() => backend.play()),
    pause: () => enqueue(() => backend.pause()),
    async seekTo(seconds) { validateTime(seconds); await enqueue(() => backend.seekTo(seconds)); },
    getStatus: read,
    remove() {
      if (removed) return Promise.resolve();
      if (removal) return removal;
      closing = true; listeners.close();
      removal = queue.catch(() => {}).then(() => backend.remove()).then(() => { removed = true; }).catch(error => { throw nativeError(error); }).finally(() => { removal = undefined; });
      return removal;
    },
  };
}
export function validatePlayerOptions(options: AudioPlayerOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected audio player options");
  for (const key of Object.keys(options)) if (!["loadTimeoutMs", "signal"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported audio option: ${key}`);
  if (options.loadTimeoutMs !== undefined && (!Number.isFinite(options.loadTimeoutMs) || options.loadTimeoutMs <= 0 || options.loadTimeoutMs > 2147483647)) throw new SparkError("E_INVALID_ARGUMENT", "loadTimeoutMs must be a positive timer duration");
  if (options.signal !== undefined && (!options.signal || typeof options.signal.aborted !== "boolean" || typeof options.signal.addEventListener !== "function" || typeof options.signal.removeEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  if (options.signal?.aborted) throw new SparkError("E_ABORTED", "Audio loading aborted");
}
/** Loading deadline begins after allocation. Wait on a native readiness promise or
 * existing backend events; allocation itself is not timed out. */
export async function waitForAudio(ready: () => Promise<boolean>, options: AudioPlayerOptions, subscribe?: (notify: () => void) => ReturnType<AudioPlayer["addListener"]>): Promise<void> {
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let changed = false, subscription: ReturnType<AudioPlayer["addListener"]> | undefined;
  let abort = () => {};
  try {
    subscription = subscribe?.(() => { changed = true; wake?.(); });
    await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => reject(new SparkError("E_ABORTED", "Audio loading aborted"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        deadline = setTimeout(() => reject(new SparkError("E_TIMEOUT", "Audio loading timed out")), options.loadTimeoutMs ?? 15000);
      }),
      (async () => {
        while (!stopped) {
          changed = false;
          if (await ready()) return;
          if (!subscribe) throw new SparkError("E_INVALID_DATA", "Native audio readiness did not acknowledge loading");
          if (!stopped && !changed) await new Promise<void>(resolve => {
            wake = resolve;
          });
        }
      })(),
    ]);
  } finally {
    stopped = true; clearTimeout(deadline); wake?.(); subscription?.remove(); options.signal?.removeEventListener("abort", abort);
  }
}
