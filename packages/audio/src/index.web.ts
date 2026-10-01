import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { playerHandle, validatePlayerOptions, waitForAudio } from "./player";
import { hasExplicitMediaSession, claimPlayerMediaSession, ownsPlayerMediaSession, releasePlayerMediaSession } from "./media-session.web";
export { createMediaSession } from "./media-session.web";
export type * from "./media-types";
import { validateSource, type AudioPlayer, type AudioSource, type AudioPlayerOptions, type AudioStatus } from "./types";
export type { AudioPlayer, AudioSource, AudioStatus, AudioPlayerOptions } from "./types";
export { useAudioPlayer } from "./hooks";
export type { AudioPlayerState, AudioPlayerHookOptions } from "./hooks";

export async function createAudioPlayer(source: AudioSource, options: AudioPlayerOptions = {}): Promise<AudioPlayer> {
  validateSource(source); validatePlayerOptions(options);
  options = { ...options };
  source = { ...source };
  if (typeof Audio === "undefined") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Browser audio is unavailable");
  const audio = new Audio(source.uri);
  audio.preload = "auto";
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
  const statusValue = (): AudioStatus => ({ playing: !audio.paused, currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0, didJustFinish: audio.ended, error: audio.error?.message ?? null, volume: audio.volume });
  async function dispose() {
    audio.pause(); audio.removeAttribute("src"); audio.load();
    if (media && ownsPlayerMediaSession(audio)) {
      for (const action of ["play", "pause", "seekto"] as const) media.setActionHandler(action, null);
      media.metadata = null; releasePlayerMediaSession(audio);
    }
  }
  try {
    await waitForAudio(async () => { if (audio.error) throw new SparkError("E_NATIVE", audio.error.message || "Could not load audio"); return audio.readyState >= 1; }, options, notify => {
      audio.addEventListener("loadedmetadata", notify); audio.addEventListener("error", notify);
      return { remove() { audio.removeEventListener("loadedmetadata", notify); audio.removeEventListener("error", notify); } };
    });
    if (media && !hasExplicitMediaSession()) {
      claimPlayerMediaSession(audio);
      media.metadata = new MediaMetadata({ title: source.title ?? "Music" });
      media.setActionHandler("play", () => { void audio.play().catch(console.error); });
      media.setActionHandler("pause", () => audio.pause());
      media.setActionHandler("seekto", event => { if (event.seekTime !== undefined) audio.currentTime = event.seekTime; });
    }
  } catch (cause) {
    try { await dispose(); } catch (cleanup) { throw new SparkError("E_NATIVE", "Audio loading and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return playerHandle({
    async setVolume(volume) { audio.volume = volume; },
    async setMetadata(metadata) {
      const value = metadata ?? {};
      if (media && ownsPlayerMediaSession(audio)) media.metadata = new MediaMetadata({ title: value.title, artist: value.artist, album: value.albumTitle, artwork: value.artworkUrl ? [{ src: value.artworkUrl }] : [] });
    },
    async play() { await audio.play(); }, async pause() { audio.pause(); },
    async seekTo(seconds) { audio.currentTime = seconds; },
    async getStatus() { return statusValue(); },
    addStatusListener(listener) {
      const events = ["playing", "pause", "timeupdate", "ended", "durationchange", "volumechange", "error", "seeked"];
      const notify = () => listener(statusValue());
      for (const event of events) audio.addEventListener(event, notify);
      notify();
      return { remove() { for (const event of events) audio.removeEventListener(event, notify); } };
    },
    remove: dispose,
  });
}
