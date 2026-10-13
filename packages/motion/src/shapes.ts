import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { invalid } from "./specs";
import { parseSvgPath, type Cubic, type Point, type Subpath } from "./svg-path";

// MotionShape paths (docs/motion.md#shapes). Every path becomes the same structure of cubic segments, so the native
// shape interpolates their points one to one: paths with the same subpaths (each open or closed alike) but different
// segment counts are subdivided, which keeps each shape exactly; paths whose subpaths differ cannot morph.

export type MotionShapeLineCap = "butt" | "round" | "square";
export type MotionShapeLineJoin = "miter" | "round" | "bevel";
export type MotionShapeFillRule = "nonzero" | "evenodd";
export interface MotionShapeStyle { lineCap?: MotionShapeLineCap; lineJoin?: MotionShapeLineJoin; fillRule?: MotionShapeFillRule }

/** The most paths a shape has, cubic segments per path (after subdivision), and characters of path data per path. */
export const SHAPE_LIMITS = { paths: 16, segments: 128, characters: 10000 } as const;
const LINE_CAPS: readonly MotionShapeLineCap[] = ["butt", "round", "square"];
const LINE_JOINS: readonly MotionShapeLineJoin[] = ["miter", "round", "bevel"];
const FILL_RULES: readonly MotionShapeFillRule[] = ["nonzero", "evenodd"];

/** Splits a cubic at its midpoint (de Casteljau): the two halves draw it exactly. */
function halve(from: Point, [x1, y1, x2, y2, x, y]: Cubic): [Cubic, Cubic] {
  const mid = (a: number, b: number) => (a + b) / 2;
  const ax = mid(from[0], x1), ay = mid(from[1], y1), bx = mid(x1, x2), by = mid(y1, y2), cx = mid(x2, x), cy = mid(y2, y);
  const dx = mid(ax, bx), dy = mid(ay, by), ex = mid(bx, cx), ey = mid(by, cy), fx = mid(dx, ex), fy = mid(dy, ey);
  return [[ax, ay, dx, dy, fx, fy], [ex, ey, cx, cy, x, y]];
}
/** The length of a segment's control polygon: an upper bound of its length. */
const span = (from: Point, [x1, y1, x2, y2, x, y]: Cubic) => Math.hypot(x1 - from[0], y1 - from[1]) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);

/** The subpath with `count` segments: its longest segments halved until it has that many. */
function subdivide({ start, segments }: Subpath, count: number): Cubic[] {
  const result = [...segments];
  while (result.length < count) {
    let longest = 0, length = -1, from = start, longestFrom = start;
    result.forEach((segment, index) => {
      const own = span(from, segment);
      if (own > length) { length = own; longest = index; longestFrom = from; }
      from = [segment[4], segment[5]];
    });
    result.splice(longest, 1, ...halve(longestFrom, result[longest]!));
  }
  return result;
}

function oneOf<T extends string>(value: T | undefined, allowed: readonly T[], name: string) {
  if (value !== undefined && !allowed.includes(value)) invalid(`${name} is ${allowed.join(", ")}`);
  return value;
}

/**
 * The native shape config of `paths` (SVG path data, docs/motion.md#shapes) and the stroke style: JSON the native shape
 * reads without another parse. Throws E_INVALID_ARGUMENT for malformed data or paths beyond the limits, and
 * E_UNSUPPORTED_OPTION for arcs and paths that cannot morph into each other.
 */
export function shapeConfig(paths: readonly string[], { lineCap, lineJoin, fillRule }: MotionShapeStyle = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > SHAPE_LIMITS.paths) invalid(`paths is an array of 1 to ${SHAPE_LIMITS.paths} SVG path strings`);
  const parsed = paths.map((d, index) => {
    const name = `paths[${index}]`;
    if (typeof d === "string" && d.length > SHAPE_LIMITS.characters) invalid(`${name} has more than ${SHAPE_LIMITS.characters} characters`);
    const subpaths = parseSvgPath(d, name);
    if (!subpaths.length) invalid(`${name} has no subpath`);
    if (subpaths.some(subpath => !subpath.segments.length)) invalid(`${name} has a subpath without a segment (M without a line or curve after it)`);
    return subpaths;
  });
  const [first] = parsed;
  parsed.forEach((subpaths, index) => {
    const closed = (list: Subpath[]) => list.map(subpath => subpath.closed ? "closed" : "open").join(", ");
    if (subpaths.length !== first!.length || subpaths.some((subpath, at) => subpath.closed !== first![at]!.closed))
      throw new SparkError("E_UNSUPPORTED_OPTION", `paths[${index}] cannot morph into paths[0]: shapes morph between paths with the same subpaths, each open or closed alike (paths[0]: ${closed(first!)}; paths[${index}]: ${closed(subpaths)})`);
  });
  const counts = first!.map((_, at) => Math.max(...parsed.map(subpaths => subpaths[at]!.segments.length)));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total > SHAPE_LIMITS.segments) invalid(`A shape path has at most ${SHAPE_LIMITS.segments} cubic segments (lines and curves); these need ${total}`);
  return {
    paths: parsed.map(subpaths => subpaths.flatMap((subpath, at) => [...subpath.start, ...subdivide(subpath, counts[at]!).flat()])),
    subpaths: first!.map((subpath, at) => [counts[at]!, subpath.closed] as const),
    lineCap: oneOf(lineCap, LINE_CAPS, "lineCap"),
    lineJoin: oneOf(lineJoin, LINE_JOINS, "lineJoin"),
    fillRule: oneOf(fillRule, FILL_RULES, "fillRule"),
  };
}
