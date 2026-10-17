import { Platform, UIManager } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { isPrimitiveKind } from "./primitives";
import type { ControlKind } from "./types";
/**
 * Whether a control kind renders natively. Button, TextInput and Select need macOS or Windows, SegmentedControl and the
 * primitive controls need macOS. Throws E_INVALID_ARGUMENT for an unknown kind.
 */
export function getControlAvailability(control: ControlKind): Availability {
  if (isPrimitiveKind(control)) {
    if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
    return UIManager.hasViewManagerConfig("SparkPrimitive") ? { available: true } : { available: false, reason: "missing-module" };
  }
  const names: Record<Exclude<ControlKind, import("./primitives.types").PrimitiveKind>, string> = { button: "SparkButton", "text-input": "SparkTextInput", select: Platform.OS === "windows" ? "SparkSelect" : "NativeSelect", "segmented-control": "NativeSegmentedControl" };
  if (!Object.hasOwn(names, control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (Platform.OS === "windows" && control === "segmented-control") return { available: false, reason: "unsupported-platform" };
  return UIManager.hasViewManagerConfig(names[control]) ? { available: true } : { available: false, reason: "missing-module" };
}
