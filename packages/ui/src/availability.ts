import { Platform, UIManager } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { controlKinds, unsupportedPlatform } from "./control";
import type { ControlKind } from "./types";
export function getControlAvailability(control: ControlKind): Availability {
  const names: Record<ControlKind, string> = { button: "SparkButton", "text-input": "SparkTextInput", select: Platform.OS === "windows" ? "SparkSelect" : "NativeSelect", "segmented-control": "NativeSegmentedControl", checkbox: "SparkButton" };
  if (!controlKinds.includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return unsupportedPlatform;
  if (Platform.OS === "windows" && (control === "segmented-control" || control === "checkbox")) return unsupportedPlatform;
  return UIManager.hasViewManagerConfig(names[control]) ? { available: true } : { available: false, reason: "missing-module" };
}
