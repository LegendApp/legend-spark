import { motionModule } from "./motion";
import { shapeConfig, type MotionShapeStyle } from "./shapes";
import { useMotionView, type MotionViewProps } from "./MotionView";
import { invalid } from "./specs";

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
  return useMotionView(props, { shape: JSON.stringify(shapeConfig(paths, { lineCap, lineJoin, fillRule })) });
}
