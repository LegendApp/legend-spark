import { Platform, UIManager } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { ControlKind } from "./types";
export function getControlAvailability(control: ControlKind): Availability {
  const names: Record<ControlKind, string> = { button: "SparkButton", "text-input": "SparkTextInput", select: Platform.OS === "windows" ? "SparkSelect" : "NativeSelect", "segmented-control": "NativeSegmentedControl" };
  if (!Object.hasOwn(names, control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (Platform.OS === "windows" && control === "segmented-control") return { available: false, reason: "unsupported-platform" };
  return UIManager.hasViewManagerConfig(names[control]) ? { available: true } : { available: false, reason: "missing-module" };
}
