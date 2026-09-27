import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { sessionOptions, sessionSnapshot, type MediaCommandName, type MediaSession, type MediaSessionOptions, type MediaSessionUpdate } from "./media-types";
let owner: object | undefined, explicit = false;
export const hasExplicitMediaSession = () => explicit;
export const claimPlayerMediaSession = (player: object) => { owner = player; };
export const ownsPlayerMediaSession = (player: object) => owner === player;
export const releasePlayerMediaSession = (player: object) => { if (owner === player) owner = undefined; };
const actions: Record<MediaCommandName, MediaSessionAction> = { play: "play", pause: "pause", nextTrack: "nexttrack", previousTrack: "previoustrack", seekTo: "seekto" };
export async function createMediaSession(options: MediaSessionOptions): Promise<MediaSession> {
  const initial = sessionOptions(options);
  const { onCommand, onError = console.error } = options;
  const available = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
  if (!available) throw new SparkError("E_UNSUPPORTED_PLATFORM", "Browser media sessions are unavailable");
  const media = available;
  const id = {}; let removed = false, state: MediaSessionUpdate = { commands: ["play", "pause"] };
  const clearActions = () => { for (const action of Object.values(actions)) { try { media.setActionHandler(action, null); } catch {} } };
  function apply(patch: MediaSessionUpdate) {
    state = { ...state, ...patch };
    const metadata = state.metadata ?? {};
    media.metadata = new MediaMetadata({ title: metadata.title, artist: metadata.artist, album: metadata.albumTitle, artwork: metadata.artworkUrl ? [{ src: metadata.artworkUrl }] : [] });
    media.playbackState = state.playbackState === "playing" ? "playing" : state.playbackState === "paused" ? "paused" : "none";
    if (media.setPositionState) {
      if (state.duration && (state.playbackRate ?? 1) > 0) media.setPositionState({ duration: state.duration, position: Math.min(state.position ?? 0, state.duration), playbackRate: state.playbackRate ?? 1 });
      else media.setPositionState();
    }
    clearActions();
    for (const command of state.commands ?? []) media.setActionHandler(actions[command], details => {
      if (owner !== id || removed) return;
      try {
        if (command === "seekTo") {
          if (typeof details.seekTime !== "number" || !Number.isFinite(details.seekTime) || details.seekTime < 0) throw new SparkError("E_INVALID_DATA", "Invalid seek command");
          onCommand({ command, position: details.seekTime });
        } else onCommand({ command });
      } catch (error) { onError(error); }
    });
  }
  owner = id; explicit = true;
  try { apply(initial); } catch (error) { clearActions(); media.metadata = null; media.playbackState = "none"; owner = undefined; explicit = false; throw error; }
  return {
    async update(patch) { if (removed || owner !== id) throw new SparkError("E_CLOSED", "Media session has been removed or replaced"); apply(sessionSnapshot(patch)); },
    async remove() { if (owner !== id) { removed = true; return; } removed = true; clearActions(); media.metadata = null; media.playbackState = "none"; media.setPositionState?.(); owner = undefined; explicit = false; },
  };
}
