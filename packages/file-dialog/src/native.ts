import { Platform } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import Native from "./NativeFileDialog";
import type { FileDialogFeature } from "./types";
/** Without a feature, reports the open/save panels. Accessory controls are macOS-only. */
export function getFileDialogAvailability(feature?: FileDialogFeature): Availability {
  if (feature !== undefined && feature !== "accessory") throw new SparkError("E_INVALID_ARGUMENT", "Unknown file dialog feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (feature === "accessory" && Platform.OS === "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
export function fileDialogNative() {
  const availability = getFileDialogAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "File dialogs require a desktop host with NativeFileDialog installed");
  return Native!;
}
