import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { sessionOptions, type MediaSession, type MediaSessionOptions } from "./media-types";
/** Expo Audio cannot attach an external playback engine to its transport controls. */
export async function createMediaSession(options: MediaSessionOptions): Promise<MediaSession> {
  sessionOptions(options);
  throw new SparkError("E_UNSUPPORTED_PLATFORM", "Standalone media sessions require desktop or web; mobile uses the player's controls");
}
