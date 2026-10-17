import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** Now-playing metadata shown in system media controls. `artworkUrl` must be an HTTP(S) URL, file URL or absolute path. */
export type AudioMetadata = { title?: string; artist?: string; albumTitle?: string; artworkUrl?: string };
/** System transport commands a media session can enable. */
export type MediaCommandName = "play" | "pause" | "nextTrack" | "previousTrack" | "seekTo";
/** A transport command delivered to `MediaSessionOptions.onCommand`; `seekTo` carries the target `position` in seconds. */
export type MediaCommand = { command: "seekTo"; position: number } | { command: Exclude<MediaCommandName, "seekTo">; position?: never };
/**
 * Now-playing state for a media session. `position` and `duration` are in seconds; `commands` lists the enabled transport controls.
 * Passing `metadata: null` clears it.
 */
export type MediaSessionUpdate = {
  metadata?: AudioMetadata | null;
  playbackState?: "playing" | "paused" | "stopped";
  position?: number;
  duration?: number;
  playbackRate?: number;
  commands?: readonly MediaCommandName[];
};
/** Options for `createMediaSession`: the initial state plus `onCommand`, and `onError` (default `console.error`) for callback and invalid-event errors. */
export interface MediaSessionOptions extends MediaSessionUpdate {
  onCommand(command: MediaCommand): void;
  onError?(error: unknown): void;
}
/** A media session returned by `createMediaSession`. `update` sends the given fields and rejects with E_CLOSED once the session is removed or replaced; `remove` releases the system controls. */
export interface MediaSession {
  update(options: MediaSessionUpdate): Promise<void>;
  remove(): Promise<void>;
}
/** Throws E_INVALID_ARGUMENT unless `value` is a finite number from 0 to 1. */
export function validateVolume(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new SparkError("E_INVALID_ARGUMENT", "Volume must be between 0 and 1");
}
/** Throws E_INVALID_ARGUMENT unless `metadata` has only string `AudioMetadata` fields and a supported `artworkUrl`. */
export function validateMetadata(metadata: AudioMetadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new SparkError("E_INVALID_ARGUMENT", "Expected audio metadata");
  for (const [key, value] of Object.entries(metadata)) {
    if (!["title", "artist", "albumTitle", "artworkUrl"].includes(key) || typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Invalid audio metadata");
  }
  if (metadata.artworkUrl && !/^(https?:\/\/|file:\/\/|\/)/.test(metadata.artworkUrl)) throw new SparkError("E_INVALID_ARGUMENT", "Artwork requires an HTTP URL, file URL or absolute path");
}
/**
 * Validates a media session update. Throws E_UNSUPPORTED_OPTION for unknown keys and E_INVALID_ARGUMENT for invalid values,
 * negative numbers, or unknown or duplicate commands.
 */
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

/** Validates `createMediaSession` options and returns their state without the callbacks. Throws E_INVALID_ARGUMENT when `onCommand` is missing. */
export function sessionOptions(options: MediaSessionOptions): MediaSessionUpdate {
  if (!options || typeof options.onCommand !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected media session callbacks");
  const { onCommand, onError, ...state } = options;
  return sessionSnapshot(state);
}
/** Validates a media session update and returns a copy without undefined fields; `metadata: null` becomes `{}`. */
export function sessionSnapshot(options: MediaSessionUpdate): MediaSessionUpdate {
  validateSession(options);
  return { ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    ...(options.metadata !== undefined ? { metadata: options.metadata === null ? {} : { ...options.metadata } } : {}),
    ...(options.commands !== undefined ? { commands: [...options.commands] } : {}),
  };
}
/** Whether `value` is a well-formed `MediaCommand`, with a finite nonnegative `position` for `seekTo` only. */
export function validMediaCommand(value: unknown): value is MediaCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as MediaCommand;
  return command.command === "seekTo" ? Number.isFinite(command.position) && command.position >= 0
    : ["play", "pause", "nextTrack", "previousTrack"].includes(command.command) && command.position === undefined;
}
