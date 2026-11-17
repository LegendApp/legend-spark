import { useState } from "react";
import { View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { finite, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeProgressIndicator from "./ProgressIndicatorNativeComponent";
export interface ProgressIndicatorProps extends Omit<SpecializedViewProps, "children"> {
  /** `bar` (default) or `spinner`. */
  variant?: "bar" | "spinner";
  /** Determinate progress from 0 to 1. Omitted or `null` animates as indeterminate. */
  value?: number | null;
  /** AppKit control size: `regular` (default), `small` or `mini`. */
  size?: "regular" | "small" | "mini";
}
export function getProgressIndicatorAvailability() { return macosViewAvailability("SparkProgressIndicator"); }
/** AppKit's NSProgressIndicator. A spinner takes its native size; a bar takes its native height and the style's width. */
export function ProgressIndicator({ variant = "bar", value, size = "regular", ref, onError, style, ...props }: ProgressIndicatorProps) {
  if (!["bar", "spinner"].includes(variant) || !["regular", "small", "mini"].includes(size)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid progress indicator options");
  if (value !== undefined && value !== null) finite(value, "progress value", 0, 1);
  const control = useControl({ ref, onError }, getProgressIndicatorAvailability());
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number }>();
  function measured(event: NativeSyntheticEvent<{ width: number; height: number }>) {
    if (!control.mounted()) return;
    const { width, height } = event?.nativeEvent ?? {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) { control.error(new SparkError("E_INVALID_DATA", "Invalid native progress size")); return; }
    setIntrinsic(previous => previous?.width === width && previous.height === height ? previous : { width, height });
  }
  const frame = [intrinsic && (variant === "spinner" ? intrinsic : { height: intrinsic.height }), style];
  if (control.failed) return <View {...props} ref={control.ref} style={style} />;
  const determinate = value !== undefined && value !== null;
  return <NativeProgressIndicator {...props} ref={control.ref} variant={variant} controlSize={size} value={determinate ? value : 0} indeterminate={!determinate} onIntrinsicSize={measured} style={frame} />;
}
