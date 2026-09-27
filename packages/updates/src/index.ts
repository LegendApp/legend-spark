import { Platform } from "react-native";
import Native from "./NativeDesktopUpdates";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, invokeNative, parseNativeResult, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";

export type UpdateUnavailableReason = "unsupported-platform" | "missing-module" | "go" | "development" | "unconfigured";
export type UpdateStatus = {
  available: true;
  started: boolean;
  canCheck: boolean;
  automaticallyChecks: boolean;
  checkIntervalSeconds: number;
  feedURL: string;
} | {
  available: false;
  reason: UpdateUnavailableReason;
  started: false;
  canCheck: false;
  automaticallyChecks: false;
  checkIntervalSeconds: null;
};
export interface UpdateConfiguration { automaticallyChecks?: boolean; checkIntervalSeconds?: number }
export interface CheckForUpdatesOptions { mode?: "interactive" | "background" }
export interface UpdateEvent {
  type: "update";
  state: "checking" | "available" | "notAvailable" | "downloading" | "downloaded" | "installing" | "error";
  version?: string;
  message?: string;
}
function native() {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Native app updates require macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Native app updater is not installed");
  return Native;
}
const unavailable = (reason: UpdateUnavailableReason): UpdateStatus => ({ available: false, reason, started: false, canCheck: false, automaticallyChecks: false, checkIntervalSeconds: null });
function validStatus(value: unknown): value is UpdateStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as UpdateStatus;
  if (status.available === false) return ["go", "development", "unconfigured"].includes(status.reason) && status.started === false && status.canCheck === false && status.automaticallyChecks === false && status.checkIntervalSeconds === null;
  return status.available === true && typeof status.started === "boolean" && typeof status.canCheck === "boolean" && typeof status.automaticallyChecks === "boolean" && Number.isFinite(status.checkIntervalSeconds) && status.checkIntervalSeconds > 0 && typeof status.feedURL === "string" && status.feedURL.startsWith("https://");
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
/** Start the scheduler after app readiness. Repeated starts are safe. */
export async function startUpdates(): Promise<void> { await command("start"); }
function options(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected update options");
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported update option: ${key}`);
}
/** Resolves when initiated. Events describe progress, not the returned promise. */
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
  if (config.checkIntervalSeconds !== undefined && (!Number.isFinite(config.checkIntervalSeconds) || config.checkIntervalSeconds <= 0)) throw new SparkError("E_INVALID_ARGUMENT", "Update interval must be positive finite seconds");
  await command("configure", config);
}
export function onUpdateEvent(listener: (event: UpdateEvent) => void): Subscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an update listener");
  native();
  return onDesktopEvent(event => {
    if (event.type === "update" && typeof event.state === "string" && ["checking", "available", "notAvailable", "downloading", "downloaded", "installing", "error"].includes(event.state) && (event.version === undefined || typeof event.version === "string") && (event.message === undefined || typeof event.message === "string")) listener(event as unknown as UpdateEvent);
  });
}
