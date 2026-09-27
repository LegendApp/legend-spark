import { View, type ColorValue, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSFSymbol from "./SFSymbolNativeComponent";
export type SFSymbolScale = "small" | "medium" | "large";
export interface SFSymbolProps extends Omit<SpecializedViewProps, "children"> {
  name: string;
  color?: ColorValue;
  scale?: SFSymbolScale;
  size?: number;
  yOffset?: number;
}
export function getSFSymbolAvailability() { return macosViewAvailability("SFSymbol"); }
export function SFSymbol({ name, color, scale = "medium", size = 24, yOffset = 0, ref, onError, style, ...props }: SFSymbolProps) {
  identifier(name, "symbol name"); finite(size, "symbol size", 1); finite(yOffset, "symbol offset", -Infinity);
  if (!["small", "medium", "large"].includes(scale)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid symbol scale");
  const control = useControl({ ref, onError }, getSFSymbolAvailability());
  const frame = [{ height: size, width: size }, style];
  function error(event: NativeSyntheticEvent<{ name: string; message: string }>) {
    if (!control.active()) return;
    if (typeof event?.nativeEvent?.name !== "string" || typeof event?.nativeEvent?.message !== "string") { control.error(new SparkError("E_INVALID_DATA", "Invalid symbol error")); return; }
    if (event.nativeEvent.name === name) control.error(new SparkError("E_NOT_FOUND", event.nativeEvent.message));
  }
  if (control.failed) return <View {...props} ref={control.ref} style={frame} />;
  return <NativeSFSymbol {...props} ref={control.ref} name={name} color={color} scale={scale} size={size} yOffset={yOffset} style={frame} onSymbolError={error} />;
}
