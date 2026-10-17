import type { Ref } from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { motionModule, motionValues, type MotionAnimationValues, type MotionTarget } from "./motion";
import type { NativeProps } from "./SparkMotionViewNativeComponent";
import { getNativeMotionView } from "./motion-view-host";
import { usePresenceMotion } from "./presence-hooks";
import { invalid, transitionSpec, type MotionTransition, type MotionValues } from "./specs";

/** Props of `MotionView`: React Native view props plus the values it mounts with and animates on enter, exit, layout and shared-element changes. */
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
  /**
   * Also match `sharedId` across windows (docs/motion.md#cross-window-shared-elements): mounting flies the element from
   * the MotionView with the same id and this flag in another window, and closing this view's window flies it back.
   */
  sharedAcrossWindows?: boolean;
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
export function MotionView(props: MotionViewProps) { return useMotionView(props); }

/** The validated native props (JSON) of a dedicated motion component's content; internal. */
export type ContentNativeProps = Pick<NativeProps, "material" | "tintColor" | "crossfade"> | Pick<NativeProps, "shape"> | Pick<NativeProps, "shaderEffect"> | Pick<NativeProps, "particleEmitter">;
/**
 * What a MotionMaterial, MotionShape, MotionShader or MotionEmitter renders in its MotionView: its native content props,
 * and the content properties (below) it owns; internal.
 */
export interface MotionContent { native: ContentNativeProps; properties: readonly string[] }
/** Properties only a component's content has, and the component that has them. */
const CONTENT_PROPERTIES: readonly (readonly [readonly string[], string])[] = [
  [["materialIntensity", "materialTintOpacity", "materialCrossfade"], "the view has no backdrop material; use a MotionMaterial"],
  [["morph", "strokeStart", "strokeEnd", "strokeWidth", "fillColor", "strokeColor"], "the view has no shape; use a MotionShape"],
  [["rippleProgress", "dissolveProgress", "distortion", "specularProgress"], "the view has no such shader effect; use a MotionShader with it"],
];

/**
 * Validates a MotionView's props (it throws while rendering) and renders its native view; a dedicated component passes
 * its content (docs/motion.md#backdrop-materials, #shapes, #shader-effects-and-particles). Internal.
 */
export function useMotionView({ initial, enter, exit, layout, sharedId, sharedAcrossWindows, transition, style, ref, ...props }: MotionViewProps, content?: MotionContent) {
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
  for (const property of initial ? Object.keys(initial) : []) {
    const family = CONTENT_PROPERTIES.find(([properties]) => properties.includes(property));
    if (family && !content?.properties.includes(property)) throw new SparkError("E_UNSUPPORTED_OPTION", `initial.${property}: ${family[1]}`);
  }
  // A dissolve is the view's mask: it shares it with neither the motion mask nor React Native's clip with per-corner radii.
  const masked = content?.properties.includes("dissolveProgress") && ((initial && Object.keys(initial).find(property => property.startsWith("mask"))) || (flat && drawnElsewhere(flat as Record<string, unknown>).mask && "style"));
  if (masked) throw new SparkError("E_UNSUPPORTED_OPTION", `${masked === "style" ? "style clips with a mask (overflow hidden with per-corner radii)" : `initial.${masked}`}: a dissolving MotionShader's mask is its dissolve`);
  if (layout !== undefined && layout !== "position" && layout !== "frame") invalid("layout is position or frame");
  if (sharedId !== undefined && (typeof sharedId !== "string" || !sharedId)) invalid("sharedId must be a non-empty string");
  if (sharedAcrossWindows !== undefined && typeof sharedAcrossWindows !== "boolean") invalid("sharedAcrossWindows must be a boolean");
  if (sharedAcrossWindows && sharedId === undefined) invalid("sharedAcrossWindows matches a sharedId; set one");
  if (transition !== undefined && layout === undefined && sharedId === undefined) invalid("transition applies to layout and sharedId changes; set one of them");
  const initialValues = json(initial, values => motionValues(values, "initial"));
  const transitionJson = layout === undefined && sharedId === undefined ? undefined : JSON.stringify(transitionSpec(transition));
  const target = usePresenceMotion(ref, enter, exit);
  const NativeMotionView = getNativeMotionView();
  return <NativeMotionView {...props} {...content?.native} ref={target} style={style} initialValues={initialValues} layout={layout} sharedId={sharedId} sharedAcrossWindows={sharedAcrossWindows} transition={transitionJson} />;
}
