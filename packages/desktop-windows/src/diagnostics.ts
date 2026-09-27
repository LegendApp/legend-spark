import { parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { macosNative } from "./macos-adapter";
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
