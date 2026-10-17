import { parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { macosNative } from "./macos-adapter";
/**
 * Startup markers as `getStartupTiming` reports them, in milliseconds on the native monotonic clock; a marker the run
 * did not record is absent. Add `clockOffsetMs` to a marker for Unix epoch milliseconds. macOS only.
 */
export interface StartupTiming {
  clockOffsetMs?: number;
  startTime?: number;
  endTime?: number;
  initializeRuntimeStart?: number;
  initializeRuntimeEnd?: number;
  executeJavaScriptBundleEntryPointStart?: number;
  executeJavaScriptBundleEntryPointEnd?: number;
  mainWindowFirstVisibleTime?: number;
  mainWindowReactRootAttachedTime?: number;
}
/** Native monotonic millisecond markers; clockOffsetMs maps them to wall-clock time. */
export function getStartupTiming(): StartupTiming {
  return parseNativeResult(macosNative().getReactNativeStartupTimingJson(), (value): value is StartupTiming => !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(marker => typeof marker === "number" && Number.isFinite(marker)));
}
