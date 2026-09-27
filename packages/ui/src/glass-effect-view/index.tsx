import { requireNativeComponent, View, type ColorValue } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { macosViewAvailability, type SpecializedViewProps } from "../specialized";
export type GlassStyle = "regular" | "clear";
export interface GlassViewProps extends SpecializedViewProps { glassStyle?: GlassStyle; tintColor?: ColorValue }
const NativeGlass = requireNativeComponent<GlassViewProps>("RNGlassEffectView");
export function getGlassAvailability() { return macosViewAvailability("RNGlassEffectView", 26); }
/** Native glass hosts its children; unsupported hosts preserve them without an effect. */
export function GlassView({ glassStyle = "regular", tintColor, ref, onError, ...props }: GlassViewProps) {
  if (glassStyle !== "regular" && glassStyle !== "clear") throw new SparkError("E_INVALID_ARGUMENT", "Invalid glass style");
  const control = useControl({ ref, onError }, getGlassAvailability());
  if (control.failed) return <View {...props} ref={control.ref} />;
  return <NativeGlass {...props} ref={control.ref} glassStyle={glassStyle} tintColor={tintColor} />;
}
