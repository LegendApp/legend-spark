import { Platform } from "react-native";
import Native from "./NativeDesktopUpdates";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, invokeNative, parseNativeResult, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
export type { Subscription } from "@legendapp/spark-desktop-app/src/contracts";

export type UpdateUnavailableReason = "unsupported-platform" | "missing-module" | "go" | "development" | "unconfigured";
export type UpdateAvailability = { available: true } | { available: false; reason: UpdateUnavailableReason };
export type UpdateStatus = {
  available: true;
  started: boolean;
  canCheck: boolean;
  /** The persisted Sparkle preference, readable before the updater starts. */
  automaticallyChecks: boolean;
  checkIntervalSeconds: number;
  feedURL: string;
  /**
   * Build (CFBundleVersion, the `build` of the `skipped` event) the user skipped with "Skip This Version".
   * Background checks stop offering it and older builds; an interactive check offers them and clears the choice.
   */
  skippedBuild: string | null;
  /** Build of a skipped major upgrade (an item whose `minimumAutoupdateVersion` this app does not meet). Background checks stop offering major upgrades with the same requirement. */
  skippedMajorBuild: string | null;
  /** ISO time of the last completed check; null until the updater has started and checked. */
  lastCheckedAt: string | null;
} | {
  available: false;
  reason: UpdateUnavailableReason;
  started: false;
  canCheck: false;
  automaticallyChecks: false;
  checkIntervalSeconds: null;
  skippedBuild: null;
  skippedMajorBuild: null;
  lastCheckedAt: null;
};
/** Sparkle's Release minimum. Shorter intervals would be silently clamped, so they are rejected. */
export const MINIMUM_UPDATE_CHECK_INTERVAL_SECONDS = 3600;
export interface UpdateConfiguration { automaticallyChecks?: boolean; checkIntervalSeconds?: number }
export interface CheckForUpdatesOptions { mode?: "interactive" | "background" }
/** `version` is the display version; `build` is the CFBundleVersion Sparkle orders, skips and selects deltas by. */
type UpdateItem = { type: "update"; version: string; build: string };
export type UpdateEvent =
  | { type: "update"; state: "checking" | "notAvailable" }
  | UpdateItem & { state: "available" | "downloaded" | "installing" }
  /** `delta` is true while Sparkle downloads a delta archive for the installed build; a failed delta is followed by another event with `delta: false` for the full archive. */
  | UpdateItem & { state: "downloading"; delta: boolean }
  /** `major` is true when the skipped item was a major upgrade (reported as `skippedMajorBuild`). */
  | UpdateItem & { state: "skipped"; major: boolean }
  | { type: "update"; state: "error"; message: string };
function native() {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Native app updates require macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Native app updater is not installed");
  return Native;
}
const unavailable = (reason: UpdateUnavailableReason): UpdateStatus => ({ available: false, reason, started: false, canCheck: false, automaticallyChecks: false, checkIntervalSeconds: null, skippedBuild: null, skippedMajorBuild: null, lastCheckedAt: null });
const nullableString = (value: unknown) => value === null || typeof value === "string";
function validStatus(value: unknown): value is UpdateStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as UpdateStatus;
  if (status.available === false) return ["go", "development", "unconfigured"].includes(status.reason) && status.started === false && status.canCheck === false && status.automaticallyChecks === false && status.checkIntervalSeconds === null && status.skippedBuild === null && status.skippedMajorBuild === null && status.lastCheckedAt === null;
  return status.available === true && typeof status.started === "boolean" && typeof status.canCheck === "boolean" && typeof status.automaticallyChecks === "boolean" && Number.isFinite(status.checkIntervalSeconds) && status.checkIntervalSeconds > 0 && typeof status.feedURL === "string" && status.feedURL.startsWith("https://") && nullableString(status.skippedBuild) && nullableString(status.skippedMajorBuild) && nullableString(status.lastCheckedAt);
}
async function command(method: string, args: object = {}): Promise<void> {
  parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), (value): value is null => value === null);
}
/** Querying never starts the updater. Missing modules and unsupported targets are reported. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (Platform.OS !== "macos") return unavailable("unsupported-platform");
  if (!Native) return unavailable("missing-module");
  return parseNativeResult(await invokeNative(() => native().call("status", "{}")), validStatus);
}
/**
 * Whether this app can self-update. Never starts the updater. Windows reports `unsupported-platform`:
 * Spark's Windows target is development-only (no release build or distribution packaging), so there is no installed release to update.
 */
export async function getUpdateAvailability(): Promise<UpdateAvailability> {
  const status = await getUpdateStatus();
  return status.available ? { available: true } : { available: false, reason: status.reason };
}
/** Start the scheduler after app readiness. Repeated starts are safe. */
export async function startUpdates(): Promise<void> { await command("start"); }
function options(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected update options");
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported update option: ${key}`);
}
/** Resolves when initiated. Events describe progress, not the returned promise. Interactive checks also offer skipped builds and, like every user-initiated Sparkle check, clear the skip choice. */
export async function checkForUpdates(config: CheckForUpdatesOptions = {}): Promise<void> {
  options(config, ["mode"]);
  const mode = config.mode ?? "interactive";
  if (!["interactive", "background"].includes(mode)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid update check mode");
  await command(mode === "interactive" ? "check" : "background");
}
/** Omission keeps a preference unchanged. Sparkle persists the user's choices. */
export async function configureUpdates(config: UpdateConfiguration): Promise<void> {
  options(config, ["automaticallyChecks", "checkIntervalSeconds"]);
  if (config.automaticallyChecks !== undefined && typeof config.automaticallyChecks !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "automaticallyChecks must be boolean");
  if (config.checkIntervalSeconds !== undefined && (!Number.isFinite(config.checkIntervalSeconds) || config.checkIntervalSeconds < MINIMUM_UPDATE_CHECK_INTERVAL_SECONDS)) throw new SparkError("E_INVALID_ARGUMENT", `Update interval must be finite and at least ${MINIMUM_UPDATE_CHECK_INTERVAL_SECONDS} seconds`);
  await command("configure", config);
}
/** Forget the user's "Skip This Version" choices (`skippedBuild` and `skippedMajorBuild`) so background checks offer them again. */
export async function clearSkippedUpdate(): Promise<void> { await command("clearSkipped"); }
// Item states and the boolean flag each one carries.
const itemFlags = new Map<string, string | undefined>([["available", undefined], ["downloaded", undefined], ["installing", undefined], ["downloading", "delta"], ["skipped", "major"]]);
export function onUpdateEvent(listener: (event: UpdateEvent) => void): Subscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an update listener");
  native();
  return onDesktopEvent(event => {
    if (event.type !== "update" || typeof event.state !== "string") return;
    const flag = itemFlags.get(event.state);
    const item = itemFlags.has(event.state) && typeof event.version === "string" && typeof event.build === "string" && (!flag || typeof event[flag] === "boolean");
    const valid = ["checking", "notAvailable"].includes(event.state) || item || (event.state === "error" && typeof event.message === "string");
    if (valid) listener(event as unknown as UpdateEvent);
  }, { types: ["update"] });
}
