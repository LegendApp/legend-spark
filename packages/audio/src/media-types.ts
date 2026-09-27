import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export type AudioMetadata = { title?: string; artist?: string; albumTitle?: string; artworkUrl?: string };
export type MediaCommandName = "play" | "pause" | "nextTrack" | "previousTrack" | "seekTo";
export type MediaCommand = { command: "seekTo"; position: number } | { command: Exclude<MediaCommandName, "seekTo">; position?: never };
export type MediaSessionUpdate = {
  metadata?: AudioMetadata | null;
  playbackState?: "playing" | "paused" | "stopped";
  position?: number;
  duration?: number;
  playbackRate?: number;
  commands?: readonly MediaCommandName[];
};
export interface MediaSessionOptions extends MediaSessionUpdate {
  onCommand(command: MediaCommand): void;
  onError?(error: unknown): void;
}
export interface MediaSession {
  update(options: MediaSessionUpdate): Promise<void>;
  remove(): Promise<void>;
}
export function validateVolume(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new SparkError("E_INVALID_ARGUMENT", "Volume must be between 0 and 1");
}
export function validateMetadata(metadata: AudioMetadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new SparkError("E_INVALID_ARGUMENT", "Expected audio metadata");
  for (const [key, value] of Object.entries(metadata)) {
    if (!["title", "artist", "albumTitle", "artworkUrl"].includes(key) || typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Invalid audio metadata");
  }
  if (metadata.artworkUrl && !/^(https?:\/\/|file:\/\/|\/)/.test(metadata.artworkUrl)) throw new SparkError("E_INVALID_ARGUMENT", "Artwork requires an HTTP URL, file URL or absolute path");
}
export function validateSession(options: MediaSessionUpdate) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected media session options");
  for (const key of Object.keys(options)) if (!["metadata", "position", "duration", "playbackRate", "playbackState", "commands"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported media option: ${key}`);
  if (options.metadata !== undefined && options.metadata !== null) validateMetadata(options.metadata);
  for (const key of ["position", "duration", "playbackRate"] as const) {
    const value = options[key]; if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid media ${key}`);
  }
  if (options.playbackState !== undefined && !["playing", "paused", "stopped"].includes(options.playbackState)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid playback state");
  if (options.commands !== undefined && (!Array.isArray(options.commands) || options.commands.some(command => !["play", "pause", "nextTrack", "previousTrack", "seekTo"].includes(command)) || new Set(options.commands).size !== options.commands.length)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid media commands");
}

export function sessionOptions(options: MediaSessionOptions): MediaSessionUpdate {
  if (!options || typeof options.onCommand !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected media session callbacks");
  const { onCommand, onError, ...state } = options;
  return sessionSnapshot(state);
}
export function sessionSnapshot(options: MediaSessionUpdate): MediaSessionUpdate {
  validateSession(options);
  return { ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    ...(options.metadata !== undefined ? { metadata: options.metadata === null ? {} : { ...options.metadata } } : {}),
    ...(options.commands !== undefined ? { commands: [...options.commands] } : {}),
  };
}
export function validMediaCommand(value: unknown): value is MediaCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as MediaCommand;
  return command.command === "seekTo" ? Number.isFinite(command.position) && command.position >= 0
    : ["play", "pause", "nextTrack", "previousTrack"].includes(command.command) && command.position === undefined;
}
