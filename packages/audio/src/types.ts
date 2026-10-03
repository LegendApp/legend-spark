import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
export type { Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import type { AudioMetadata } from "./media-types";
export * from "./media-types";
/** Seconds throughout. Commands reject when the backend cannot complete them. */
export type AudioStatus = { playing: boolean; currentTime: number; duration: number; didJustFinish: boolean; error: string | null; volume: number };
export type AudioSource = { uri: string; title?: string };
export interface AudioPlayerOptions { loadTimeoutMs?: number; signal?: AbortSignal }
export interface AudioPlayer {
  setVolume(volume: number): Promise<void>;
  setMetadata(metadata: AudioMetadata | null): Promise<void>;
  addListener(event: "playbackStatusUpdate", listener: (status: AudioStatus) => void): Subscription;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getStatus(): Promise<AudioStatus>;
  remove(): Promise<void>;
}
export function validateSource(source: AudioSource) {
  if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.uri !== "string" || !source.uri || source.uri.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Audio requires a URI or absolute desktop file path");
  for (const key of Object.keys(source)) if (!["uri", "title"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported audio source option: ${key}`);
  if (source.title !== undefined && typeof source.title !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Audio title must be a string");
}
export function validateTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new SparkError("E_INVALID_ARGUMENT", "Seek position must be a finite, nonnegative number of seconds");
}
