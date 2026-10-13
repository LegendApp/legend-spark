import { useMemo } from "react";
import { motionModule } from "./motion";
import { shapeConfig, type MotionShapeStyle } from "./shapes";
import { useMotionView, type MotionViewProps } from "./MotionView";
import { invalid } from "./specs";

/** The motion properties a MotionShape has (docs/motion.md#shapes). */
const SHAPE_PROPERTIES = ["morph", "strokeStart", "strokeEnd", "strokeWidth", "fillColor", "strokeColor"];

export interface MotionShapeProps extends Omit<MotionViewProps, "children">, MotionShapeStyle {
  /**
   * The shapes, as SVG path data in points from the view's top-left corner (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `Z`):
   * `morph` k shows path k. Paths morph point by point, from each subpath's start; they need the same subpaths, each
   * open or closed alike. A change applies at once.
   */
  paths: readonly string[];
}

/**
 * A MotionView that draws a shape (a CAShapeLayer): `morph` moves it between its paths, `strokeStart` and `strokeEnd`
 * trim its stroke, and `fillColor`, `strokeColor` and `strokeWidth` paint it, all motion properties the engine animates
 * on the compositor. It has no children. Throws a SparkError where motion is unavailable or the paths are invalid.
 */
export function MotionShape({ paths, lineCap, lineJoin, fillRule, ...props }: MotionShapeProps) {
  motionModule();  // where motion is unavailable, that is the error, whatever the paths
  if ((props as { children?: unknown }).children != null) invalid("MotionShape has no children; put content in a sibling");
  // Parsed and subdivided once per change of the path contents or the stroke style, not on every render.
  const key = JSON.stringify([paths, lineCap, lineJoin, fillRule]);
  const shape = useMemo(() => {
    const [source, cap, join, rule] = JSON.parse(key);
    return JSON.stringify(shapeConfig(source, { lineCap: cap ?? undefined, lineJoin: join ?? undefined, fillRule: rule ?? undefined }));
  }, [key]);
  return useMotionView(props, { native: { shape }, properties: SHAPE_PROPERTIES });
}
