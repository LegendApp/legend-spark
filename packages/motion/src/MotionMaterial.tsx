import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { parseColor, type MotionColor } from "./colors";
import { isGlass, requireMaterial, type MotionMaterialBlending, type MotionMaterialName, type MotionMaterialState } from "./materials";
import { useMotionView, type MotionViewProps } from "./MotionView";
import { invalid, transitionSpec, type MotionTransition } from "./specs";

export interface MotionMaterialProps extends Omit<MotionViewProps, "children"> {
  /** The backdrop material. A change crossfades to the new one with `crossfade`. */
  material: MotionMaterialName;
  /** Default `behindWindow`. Not for Liquid Glass. */
  blendingMode?: MotionMaterialBlending;
  /** Default `followsWindowActiveState`. Not for Liquid Glass. */
  state?: MotionMaterialState;
  /** The emphasized look of a selection material. Not for Liquid Glass. */
  emphasized?: boolean;
  /** A color over the material, shown at `materialTintOpacity` (default 1). */
  tintColor?: MotionColor;
  /** How a material change crossfades. Default: a 250 ms ease-in-out timing curve. */
  crossfade?: MotionTransition;
}

const BLENDING: readonly MotionMaterialBlending[] = ["behindWindow", "withinWindow"];
const STATES: readonly MotionMaterialState[] = ["followsWindowActiveState", "active", "inactive"];

/**
 * A MotionView that shows a backdrop material: its `materialIntensity` and `materialTintOpacity` animate like any motion
 * property, and a change of `material` crossfades. It has no children: put it behind content. Throws a SparkError where
 * motion or the material is unavailable.
 */
export function MotionMaterial({ material, blendingMode, state, emphasized, tintColor, crossfade, ...props }: MotionMaterialProps) {
  requireMaterial(material);
  if ((props as { children?: unknown }).children != null) invalid("MotionMaterial has no children; put it behind content as a sibling");
  if (blendingMode !== undefined && !BLENDING.includes(blendingMode)) invalid("blendingMode is behindWindow or withinWindow");
  if (state !== undefined && !STATES.includes(state)) invalid("state is followsWindowActiveState, active or inactive");
  if (emphasized !== undefined && typeof emphasized !== "boolean") invalid("emphasized must be a boolean");
  const unsupported = isGlass(material) && Object.entries({ blendingMode, state, emphasized }).find(([, value]) => value !== undefined)?.[0];
  if (unsupported) throw new SparkError("E_UNSUPPORTED_OPTION", `Liquid Glass has no ${unsupported}`);
  const nativeMaterial = {
    material: JSON.stringify({ material, blendingMode, state, emphasized }),
    tintColor: tintColor === undefined ? undefined : JSON.stringify(parseColor(tintColor, "tintColor")),
    crossfade: JSON.stringify(transitionSpec(crossfade ?? { type: "timing", durationMs: 250 })),
  };
  return useMotionView(props, nativeMaterial);
}
