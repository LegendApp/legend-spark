import { SparkError, nativeError } from "@legendapp/spark-desktop-app/src/contracts";
import { playerHandle, validatePlayerOptions, waitForAudio } from "./player";
export type * from "./media-types";
export { createMediaSession } from "./media-session-unavailable";
import { createAudioPlayer as createExpoPlayer, setAudioModeAsync } from "expo-audio";
import { validateSource, type AudioPlayer, type AudioSource, type AudioPlayerOptions, type AudioStatus } from "./types";
export type { AudioPlayer, AudioSource, AudioStatus, AudioPlayerOptions } from "./types";
export async function createAudioPlayer(source: AudioSource, options: AudioPlayerOptions = {}): Promise<AudioPlayer> {
  validateSource(source); validatePlayerOptions(options);
  options = { ...options };
  source = { ...source };
  const input = source;
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" });
  validatePlayerOptions(options);
  const player = createExpoPlayer(input.uri);
  let ended = false, failed = false, notifyReady: (() => void) | undefined;
  const listeners = new Set<(status: AudioStatus) => void>();
  const statusValue = (status = player.currentStatus): AudioStatus => ({ playing: status.playing, currentTime: status.currentTime, duration: status.duration, didJustFinish: ended, error: failed ? "Audio could not be decoded or loaded" : null, volume: player.volume });
  const subscription = player.addListener("playbackStatusUpdate", status => {
    if (status.didJustFinish) ended = true; failed = status.playbackState === "error";
    notifyReady?.();
    if (listeners.size) { const value = statusValue(status); for (const listener of listeners) listener(value); }
  });
  try {
    await waitForAudio(async () => { if (failed || player.currentStatus.playbackState === "error") throw new SparkError("E_NATIVE", "Audio could not be loaded"); return player.isLoaded; }, options,
      notify => { notifyReady = notify; return { remove() { notifyReady = undefined; } }; });
    player.setActiveForLockScreen(true, { title: input.title ?? "Music" });
  } catch (cause) {
    subscription.remove();
    try { player.remove(); } catch (cleanup) { throw new SparkError("E_NATIVE", "Audio loading and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw nativeError(cause);
  }
  return playerHandle({
    async setVolume(volume) { player.volume = volume; },
    async setMetadata(metadata) { player.updateLockScreenMetadata(metadata ?? {}); },
    async play() { ended = false; player.play(); },
    async pause() { player.pause(); },
    async seekTo(seconds) { ended = false; await player.seekTo(seconds); },
    async getStatus() { return statusValue(); },
    addStatusListener(listener) { listeners.add(listener); listener(statusValue()); return { remove() { listeners.delete(listener); } }; },
    async remove() { listeners.clear(); subscription.remove(); player.clearLockScreenControls(); player.remove(); },
  });
}

export { useAudioPlayer } from "./hooks";
export type { AudioPlayerState, AudioPlayerHookOptions } from "./hooks";
