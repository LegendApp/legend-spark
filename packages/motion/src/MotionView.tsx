import type { Ref } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { motionModule, type MotionAnimationValues, type MotionTarget } from "./motion";
import { getNativeMotionView } from "./motion-view-host";
import { usePresenceMotion } from "./presence-hooks";
import { channels, invalid, transitionSpec, type MotionTransition, type MotionValues } from "./specs";

export interface MotionViewProps extends ViewProps {
  /** Values applied once, at mount. Motion owns `opacity` and `transform` afterwards, so `style` must not set them. */
  initial?: MotionValues;
  /** Animated at mount (from `initial`), and when a MotionPresence child that is exiting comes back. */
  enter?: MotionAnimationValues;
  /** Animated when the enclosing MotionPresence child is removed; the presence keeps it mounted until this settles. */
  exit?: MotionAnimationValues;
  /**
   * Animates layout changes from where the view showed: `position` keeps its leading top corner moving smoothly (a
   * size change applies at once), `frame` also scales it from its previous size. Drives translate (and scale).
   */
  layout?: "position" | "frame";
  /** Shared-element id: a MotionView mounting with it animates from where another MotionView with it showed, in the same window. */
  sharedId?: string;
  /** How `layout` and `sharedId` changes animate. Default: the `smooth` spring. */
  transition?: MotionTransition;
  ref?: Ref<MotionTarget>;
}

const json = <T,>(value: T | undefined, make: (value: T) => unknown) => value === undefined ? undefined : JSON.stringify(make(value));

/** A view whose own layer the motion engine animates. Throws a SparkError where motion is unavailable: there is no JavaScript-driven substitute. */
export function MotionView({ initial, enter, exit, layout, sharedId, transition, style, ref, ...props }: MotionViewProps) {
  motionModule();
  const flat = StyleSheet.flatten(style);
  if (flat && ("transform" in flat || "opacity" in flat)) invalid("MotionView owns opacity and transform; set them with initial, animate or setMotionValues");
  if (layout !== undefined && layout !== "position" && layout !== "frame") invalid("layout is position or frame");
  if (sharedId !== undefined && (typeof sharedId !== "string" || !sharedId)) invalid("sharedId must be a non-empty string");
  if (transition !== undefined && layout === undefined && sharedId === undefined) invalid("transition applies to layout and sharedId changes; set one of them");
  const initialValues = json(initial, values => Object.fromEntries(channels(values, "initial").map(([property, value]) =>
    [property, Number.isFinite(value) ? value : invalid(`initial.${property} must be a finite number`)])));
  const transitionJson = layout === undefined && sharedId === undefined ? undefined : JSON.stringify(transitionSpec(transition));
  const target = usePresenceMotion(ref, enter, exit);
  const NativeMotionView = getNativeMotionView();
  return <NativeMotionView {...props} ref={target} style={style} initialValues={initialValues} layout={layout} sharedId={sharedId} transition={transitionJson} />;
}
