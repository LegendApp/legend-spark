import { Platform, UIManager, type ViewProps } from "react-native";
import type { Ref } from "react";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { ControlRef } from "./types";
export interface SpecializedViewProps extends ViewProps { ref?: Ref<ControlRef>; onError?: (error: SparkError) => void }
export function macosViewAvailability(name: string, minimumVersion = 14): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (Number.parseInt(String(Platform.Version), 10) < minimumVersion) return { available: false, reason: "host-restriction" };
  return UIManager.hasViewManagerConfig(name) ? { available: true } : { available: false, reason: "missing-module" };
}
export function finite(value: unknown, name: string, minimum = 0, maximum = Infinity): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new SparkError("E_INVALID_ARGUMENT", `Invalid ${name}`);
}
export function identifier(value: unknown, name = "ID"): asserts value is string {
  if (typeof value !== "string" || !value.length || value.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", `Expected a nonempty ${name}`);
}
export function appearance(value: unknown) {
  if (!["system", "light", "dark"].includes(value as string)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid appearance");
}
export function callback(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} callback`);
}
