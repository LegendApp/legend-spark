import { requireNativeComponent, View, type ColorValue } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { macosViewAvailability, type SpecializedViewProps } from "../specialized";
/** NSGlassEffectView style for `GlassView`: `regular` (default) or `clear`. */
export type GlassStyle = "regular" | "clear";
/** Props for `GlassView`: a View's props plus the glass style and an optional tint color for the glass. */
export interface GlassViewProps extends SpecializedViewProps { glassStyle?: GlassStyle; tintColor?: ColorValue }
const NativeGlass = requireNativeComponent<GlassViewProps>("RNGlassEffectView");
/** Whether `GlassView` renders native glass: macOS 26 and later with the native view linked. */
export function getGlassAvailability() { return macosViewAvailability("RNGlassEffectView", 26); }
/** Native glass hosts its children; unsupported hosts preserve them without an effect. */
export function GlassView({ glassStyle = "regular", tintColor, ref, onError, ...props }: GlassViewProps) {
  if (glassStyle !== "regular" && glassStyle !== "clear") throw new SparkError("E_INVALID_ARGUMENT", "Invalid glass style");
  const control = useControl({ ref, onError }, getGlassAvailability());
  if (control.failed) return <View {...props} ref={control.ref} />;
  return <NativeGlass {...props} ref={control.ref} glassStyle={glassStyle} tintColor={tintColor} />;
}
