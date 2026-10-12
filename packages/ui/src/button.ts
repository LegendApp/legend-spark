import { Platform, UIManager } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { ButtonAvailabilityOptions, ButtonVariant } from "./types";

const variants: readonly ButtonVariant[] = ["default", "bordered", "borderless", "push", "bevel", "toolbar", "help", "cancel", "destructive"];
export function validateButtonOptions(options: ButtonAvailabilityOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options) || (options.variant !== undefined && !variants.includes(options.variant)) || (options.size !== undefined && !["mini", "small", "regular", "large"].includes(options.size))) {
    throw new SparkError("E_INVALID_ARGUMENT", "Invalid button style or size");
  }
}
const portableVariants: readonly (ButtonVariant | undefined)[] = [undefined, "default", "bordered", "borderless"];
/** Explicit sizes and the AppKit-only styles; `default`, `bordered` and `borderless` render on every platform. */
export function hasAppKitButtonOptions(options: ButtonAvailabilityOptions) {
  return options.size !== undefined || !portableVariants.includes(options.variant);
}
/** AppKit-only styles and explicit native sizes require macOS. */
export function getButtonAvailability(options: ButtonAvailabilityOptions = {}): Availability {
  validateButtonOptions(options);
  for (const key of Object.keys(options)) if (key !== "variant" && key !== "size") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported button availability option: ${key}`);
  if (Platform.OS !== "macos" && hasAppKitButtonOptions(options)) return { available: false, reason: "unsupported-platform" };
  if (Platform.OS === "macos" || Platform.OS === "windows") return UIManager.hasViewManagerConfig("SparkButton") ? { available: true } : { available: false, reason: "missing-module" };
  if (Platform.OS === "web") return { available: true };
  if (Platform.OS === "ios" || Platform.OS === "android") {
    const { requireOptionalNativeModule } = require("expo-modules-core") as typeof import("expo-modules-core");
    return requireOptionalNativeModule("ExpoUI") ? { available: true } : { available: false, reason: "missing-module" };
  }
  return { available: false, reason: "unsupported-platform" };
}
export function requireAppKitButtonOptions(options: ButtonAvailabilityOptions) {
  if (!hasAppKitButtonOptions(options)) return;
  const availability = getButtonAvailability({ variant: options.variant, size: options.size });
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Native button style or size is unavailable");
}
/** Narrows the legacy mobile/web variant after rejecting unsupported options. */
export function portableButtonVariant(options: ButtonAvailabilityOptions): "default" | "bordered" | "borderless" {
  if (hasAppKitButtonOptions(options)) throw new SparkError("E_UNSUPPORTED_PLATFORM", "Native button styles and sizes require macOS");
  return options.variant as "default" | "bordered" | "borderless" | undefined ?? "default";
}
