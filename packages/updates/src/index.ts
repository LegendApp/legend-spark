import Native from "./NativeDesktopUpdates";
import { onDesktopEvent } from "@legendapp/spark-desktop-app";

export type UpdateStatus = {
  available: boolean;
  reason?: "go" | "development" | "unconfigured";
  started: boolean;
  canCheck: boolean;
  automaticallyChecks: boolean;
  updateCheckInterval: number;
  feedURL?: string;
};
export type UpdateEvent = { type: "update"; state: "checking" | "available" | "notAvailable" | "downloading" | "downloaded" | "installing" | "error"; version?: string; message?: string };
async function call<T = void>(method: string, args: object = {}): Promise<T> { return JSON.parse(await Native.call(method, JSON.stringify(args))) as T; }
export const getUpdateStatus = () => call<UpdateStatus>("status");
/** Start Sparkle's scheduler after the application is ready. Safe to call again. */
export const startUpdates = () => call<UpdateStatus>("start");
/** Opens Sparkle's standard check/download/install UI. Resolves when the check starts. */
export const checkForUpdates = () => call("check");
/** Change this only in response to the user's preference; Sparkle persists it. */
export const setAutomaticUpdateChecks = (enabled: boolean) => call("automatic", { enabled });
export function onUpdateEvent(listener: (event: UpdateEvent) => void) {
  return onDesktopEvent(event => { if (event.type === "update") listener(event as UpdateEvent); });
}

/** One updater instance backs both the functional API and this settings facade. */
export const AutoUpdater = {
  isAvailable: () => Native.isAvailable(),
  async checkForUpdates() { await checkForUpdates(); return true; },
  async checkForUpdatesInBackground() { await call("background"); return true; },
  async getAutomaticallyChecksForUpdates() { return (await getUpdateStatus()).automaticallyChecks; },
  async setAutomaticallyChecksForUpdates(enabled: boolean) { await setAutomaticUpdateChecks(enabled); return true; },
  async getUpdateCheckInterval() { return (await getUpdateStatus()).updateCheckInterval; },
  async setUpdateCheckInterval(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new TypeError("Update interval must be positive and finite");
    await call("interval", { seconds }); return true;
  },
};
