import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { easing as resolveEasing, invalid, keyframes, type AnimationOptions, type Easing, type KeyframesSpec } from "./specs";

// Path animation (docs/motion.md#path-animation): an SVG path becomes keyframes of translateX and translateY (and
// rotate), sampled at even distances along it, so the view moves along the path at the easing's pace. The engine
// plays them like any keyframes: on the compositor, interruptible, with the Reduce Motion alternate.

export interface MotionPathOptions extends Pick<AnimationOptions, "delayMs" | "repeat" | "reverse"> {
  durationMs: number;
  /** The pace along the path (default `easeInOut`). */
  easing?: Easing;
  /** Turn the view to follow the path's direction (degrees, 0 along +x). */
  rotate?: boolean;
}
export interface MotionPathValues {
  translateX: KeyframesSpec;
  translateY: KeyframesSpec;
  rotate?: KeyframesSpec;
}

type Point = readonly [number, number];
const OPTIONS = ["durationMs", "easing", "rotate", "delayMs", "repeat", "reverse"];
/** Samples per curve segment when measuring, and the spacing of keyframes along the path in points. */
const FLATTEN = 32, SPACING = 4, MAX_KEYFRAMES = 240;

/** The path's points, curves flattened: M, L, H, V, C, S, Q, T and Z, absolute and relative. Arcs are E_UNSUPPORTED_OPTION. */
function flatten(d: string): Point[] {
  if (typeof d !== "string") invalid("A motion path is an SVG path string");
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const points: Point[] = [];
  let index = 0, command = "", current: Point = [0, 0], start: Point = [0, 0], control: Point | undefined;
  const number = () => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) invalid(`The motion path has an invalid number near ${tokens[index - 1] ?? "its end"}`);
    return value;
  };
  const point = (relative: boolean): Point => { const x = number(), y = number(); return relative ? [current[0] + x, current[1] + y] : [x, y]; };
  const curve = (at: (t: number) => Point) => { for (let i = 1; i <= FLATTEN; i++) points.push(at(i / FLATTEN)); };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index]!)) command = tokens[index++]!;
    else if (!command) invalid("A motion path starts with M");
    const relative = command === command.toLowerCase(), kind = command.toUpperCase();
    if (!points.length && kind !== "M") invalid("A motion path starts with M");
    let next: Point;
    switch (kind) {
      case "M": next = point(relative); start = next; points.push(next); command = relative ? "l" : "L"; control = undefined; current = next; continue;
      case "L": next = point(relative); points.push(next); control = undefined; break;
      case "H": next = [relative ? current[0] + number() : number(), current[1]]; points.push(next); control = undefined; break;
      case "V": next = [current[0], relative ? current[1] + number() : number()]; points.push(next); control = undefined; break;
      case "C": case "S": {
        const from = current;
        const c1: Point = kind === "C" ? point(relative) : control ? [2 * from[0] - control[0], 2 * from[1] - control[1]] : from;
        const c2 = point(relative);
        next = point(relative);
        const end = next;
        curve(t => { const u = 1 - t; return [u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0], u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1]]; });
        control = c2;
        break;
      }
      case "Q": case "T": {
        const from = current;
        const c: Point = kind === "Q" ? point(relative) : control ? [2 * from[0] - control[0], 2 * from[1] - control[1]] : from;
        next = point(relative);
        const end = next;
        curve(t => { const u = 1 - t; return [u * u * from[0] + 2 * u * t * c[0] + t * t * end[0], u * u * from[1] + 2 * u * t * c[1] + t * t * end[1]]; });
        control = c;
        break;
      }
      case "Z": next = start; points.push(next); control = undefined; command = ""; break;
      case "A": throw new SparkError("E_UNSUPPORTED_OPTION", "Motion paths do not take arcs; draw them with cubic curves (C)");
      default: return invalid(`Unknown motion path command ${command}`);
    }
    current = next;
  }
  if (points.length < 2) invalid("A motion path needs at least two points");
  return points;
}

/** Normalized time when an easing reaches `progress`: its inverse, by bisection (easings rise monotonically along the path). */
function inverse([x1, y1, x2, y2]: readonly number[], progress: number) {
  const at = (u: number, a: number, b: number) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (at(mid, y1!, y2!) < progress) lo = mid; else hi = mid; }
  return at((lo + hi) / 2, x1!, x2!);
}

/**
 * Keyframes that move a view along an SVG path, in points relative to where it rests (start the path at `M0 0`). Spread
 * them into `animate`: `animate(view, { ...motionPath("M0 0 C60 -80 140 80 200 0", { durationMs: 900, rotate: true }) })`.
 */
export function motionPath(d: string, options: MotionPathOptions): MotionPathValues {
  if (!options || typeof options !== "object") invalid("motionPath needs options with durationMs");
  const unknown = Object.keys(options).find(key => !OPTIONS.includes(key));
  if (unknown) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown motionPath option ${unknown}`);
  const { durationMs, easing = "easeInOut", rotate = false, ...timing } = options;
  const curve = resolveEasing(easing);
  if (curve.some(value => value < 0 || value > 1)) throw new SparkError("E_UNSUPPORTED_OPTION", "A motion path's easing stays within the path: its control points are in [0, 1]");
  const points = flatten(d);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const total = lengths.at(-1)!;
  if (!(total > 0)) invalid("A motion path needs a length");
  // Even distances along the path; each keyframe lands when the easing has covered that share of it.
  const count = Math.min(MAX_KEYFRAMES, Math.max(8, Math.ceil(total / SPACING)));
  const x: number[] = [], y: number[] = [], angles: number[] = [], offsets: number[] = [];
  let segment = 1;
  for (let k = 1; k <= count; k++) {
    const distance = total * k / count;
    while (segment < points.length - 1 && lengths[segment]! < distance) segment++;
    const [a, b] = [points[segment - 1]!, points[segment]!], span = lengths[segment]! - lengths[segment - 1]!;
    const along = span > 0 ? (distance - lengths[segment - 1]!) / span : 1;
    const offset = k === count ? 1 : inverse(curve, k / count);
    if (offset <= (offsets.at(-1) ?? 0)) continue;
    offsets.push(offset);
    x.push(a[0] + (b[0] - a[0]) * along);
    y.push(a[1] + (b[1] - a[1]) * along);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, previous = angles.at(-1);
    angles.push(previous === undefined ? angle : previous + ((((angle - previous) % 360) + 540) % 360 - 180));
  }
  const paced = { durationMs, offsets, easing: "linear" as const, ...timing };
  return { translateX: keyframes(x, paced), translateY: keyframes(y, paced), ...(rotate && { rotate: keyframes(angles, paced) }) };
}
