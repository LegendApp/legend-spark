import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopMedia";

/** macOS with NativeDesktopMedia installed. Windows reports `unsupported-platform` (#403). */
export function mediaAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
export function requireMedia(feature: string): Spec {
  const availability = mediaAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${feature} requires macOS with NativeDesktopMedia installed`);
  return Native!;
}

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** Rejects unknown keys (E_UNSUPPORTED_OPTION), even with an undefined value. */
export function checkOptions(options: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isRecord(options)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${what}`);
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${what} option: ${key}`);
  return options;
}
export function checkRange(value: unknown, name: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!isNumber(value) || value < minimum || value > maximum) throw new SparkError("E_INVALID_ARGUMENT", `${name} is ${minimum}–${maximum}`);
  return value;
}
export function checkBoolean(value: unknown, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${name} is a boolean`);
  return value as boolean | undefined;
}
export function checkSignal(signal: unknown): AbortSignal | undefined {
  if (signal !== undefined && (!signal || typeof (signal as AbortSignal).aborted !== "boolean" || typeof (signal as AbortSignal).addEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  return signal as AbortSignal | undefined;
}
export function checkCallback(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "function") throw new SparkError("E_INVALID_ARGUMENT", `${name} is a function`);
}

/** Calls a native media operation and validates its JSON result. */
export async function call<T>(native: Spec, method: string, args: Record<string, unknown>, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}
export const isNull = (value: unknown): value is null => value === null;
let sequence = 0;
/** Unique across runtimes of the process: native shares one registry. */
export const uniqueId = (kind: string) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${++sequence}`;
