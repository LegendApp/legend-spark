import type { Ref } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { motionModule, motionValues, type MotionAnimationValues, type MotionTarget } from "./motion";
import { getNativeMotionView } from "./motion-view-host";
import { usePresenceMotion } from "./presence-hooks";
import { invalid, transitionSpec, type MotionTransition, type MotionValues } from "./specs";

export interface MotionViewProps extends ViewProps {
  /**
   * Values applied once, at mount. Motion owns `opacity` and `transform`, so `style` must not set them. `style` may set
   * the background color, corner radius and shadow until motion first drives them; set each in one place.
   */
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
/** Style keys of layer properties motion always owns. */
const OWNED = ["transform", "opacity"];
/** Style keys that set a motion property, which `initial` must not set too (docs/motion.md#visual-effects). */
const SIDE = /^border(Top|Right|Bottom|Left|Start|End|Block|BlockStart|BlockEnd)(Width|Color)$/;
const CORNER = /^border(Top|Bottom|Start|End)(Left|Right|Start|End)Radius$/;
/**
 * Style that React Native draws on layers other than the view's own (docs/motion.md#visual-effects): borders it draws
 * itself carry the background and corners, and a clip with per-corner radii is a mask. Motion cannot drive those; the
 * native view rejects animating them, and this rejects `initial` setting them.
 */
function drawnElsewhere(flat: Record<string, unknown>) {
  const keys = Object.keys(flat), clips = flat.overflow === "hidden", corners = keys.some(key => CORNER.test(key));
  const borders = corners || keys.some(key => SIDE.test(key)) || (flat.borderStyle !== undefined && flat.borderStyle !== "solid")
    || (typeof flat.borderWidth === "number" && flat.borderWidth > 0 && !clips && flat.borderColor !== "transparent");
  return { borders, mask: clips && corners };
}
const STYLED: Record<string, RegExp> = { backgroundColor: /^backgroundColor$/, borderRadius: /^border\w*Radius$/, shadowOpacity: /^shadowOpacity$/, shadowRadius: /^shadowRadius$/, shadowOffsetX: /^shadowOffset$/, shadowOffsetY: /^shadowOffset$/ };

/** A view whose own layer the motion engine animates. Throws a SparkError where motion is unavailable: there is no JavaScript-driven substitute. */
export function MotionView({ initial, enter, exit, layout, sharedId, transition, style, ref, ...props }: MotionViewProps) {
  motionModule();
  const flat = StyleSheet.flatten(style);
  const keys = flat ? Object.keys(flat) : [];
  const owned = keys.find(key => OWNED.includes(key));
  if (owned) invalid(`MotionView owns ${owned}; set it with initial, animate or setMotionValues`);
  const twice = initial && Object.keys(initial).find(property => STYLED[property] && keys.some(key => STYLED[property]!.test(key)));
  if (twice) invalid(`initial and style both set ${twice}; set it in one place`);
  if (initial && flat) {
    const elsewhere = drawnElsewhere(flat as Record<string, unknown>), set = Object.keys(initial);
    const drawn = set.find(property => (elsewhere.borders && (property === "backgroundColor" || property === "borderRadius")) || (elsewhere.mask && property.startsWith("mask")));
    if (drawn) throw new SparkError("E_UNSUPPORTED_OPTION", `initial.${drawn}: React Native draws this view's ${drawn.startsWith("mask") ? "clip as a mask (overflow hidden with per-corner radii)" : "border and background on their own layer"}, which motion cannot drive`);
  }
  if (layout !== undefined && layout !== "position" && layout !== "frame") invalid("layout is position or frame");
  if (sharedId !== undefined && (typeof sharedId !== "string" || !sharedId)) invalid("sharedId must be a non-empty string");
  if (transition !== undefined && layout === undefined && sharedId === undefined) invalid("transition applies to layout and sharedId changes; set one of them");
  const initialValues = json(initial, values => motionValues(values, "initial"));
  const transitionJson = layout === undefined && sharedId === undefined ? undefined : JSON.stringify(transitionSpec(transition));
  const target = usePresenceMotion(ref, enter, exit);
  const NativeMotionView = getNativeMotionView();
  return <NativeMotionView {...props} ref={target} style={style} initialValues={initialValues} layout={layout} sharedId={sharedId} transition={transitionJson} />;
}
