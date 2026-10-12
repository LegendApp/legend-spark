import type { Ref } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { motionModule, type MotionTarget } from "./motion";
import { getNativeMotionView } from "./motion-view-host";
import { channels, invalid, type MotionValues } from "./specs";

export interface MotionViewProps extends ViewProps {
  /** Values applied once, at mount. Motion owns `opacity` and `transform` afterwards, so `style` must not set them. */
  initial?: MotionValues;
  ref?: Ref<MotionTarget>;
}

/** A view whose own layer the motion engine animates. Throws a SparkError where motion is unavailable: there is no JavaScript-driven substitute. */
export function MotionView({ initial, style, ...props }: MotionViewProps) {
  motionModule();
  const flat = StyleSheet.flatten(style);
  if (flat && ("transform" in flat || "opacity" in flat)) invalid("MotionView owns opacity and transform; set them with initial, animate or setMotionValues");
  const initialValues = initial === undefined ? undefined : JSON.stringify(Object.fromEntries(channels(initial, "initial").map(([property, value]) =>
    [property, Number.isFinite(value) ? value : invalid(`initial.${property} must be a finite number`)])));
  const NativeMotionView = getNativeMotionView();
  return <NativeMotionView {...props} style={style} initialValues={initialValues} />;
}
