import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { playerHandle, validatePlayerOptions, waitForAudio } from "./player";
export { createMediaSession } from "./media-session";
export type * from "./media-types";
import Native from "./NativeSparkAudio";
import { validateSource, type AudioPlayer, type AudioSource, type AudioPlayerOptions, type AudioStatus } from "./types";
export type { AudioPlayer, AudioSource, AudioStatus, AudioPlayerOptions } from "./types";
let sequence = 0;
export async function createAudioPlayer(source: AudioSource, options: AudioPlayerOptions = {}): Promise<AudioPlayer> {
  validateSource(source); validatePlayerOptions(options);
  options = { ...options };
  source = { ...source };
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Audio requires a client with @legendapp/spark-audio");
  const native = Native, id = `audio-${Date.now()}-${++sequence}`;
  const call = async (method: string, args = {}): Promise<unknown> => parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify({ id, ...args }))), (value): value is unknown => true);
  const command = async (method: string, args = {}) => { if (await call(method, args) !== null) throw new SparkError("E_INVALID_DATA", "Invalid audio command result"); };
  try {
    await command("create", source);
    await waitForAudio(async () => { const ready = await call("ready"); if (typeof ready !== "boolean") throw new SparkError("E_INVALID_DATA", "Invalid audio readiness"); return ready; }, options);
  } catch (cause) {
    try { await command("remove"); } catch (cleanup) { throw new SparkError("E_NATIVE", "Audio loading and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return playerHandle({
    setVolume: volume => command("volume", { volume }),
    setMetadata: metadata => command("metadata", { metadata: metadata ?? {} }),
    play: () => command("play"), pause: () => command("pause"),
    seekTo: seconds => command("seek", { seconds }),
    getStatus: async () => await call("status") as AudioStatus,
    remove: () => command("remove"),
  });
}

export { useAudioPlayer } from "./hooks";
export type { AudioPlayerState, AudioPlayerHookOptions } from "./hooks";
