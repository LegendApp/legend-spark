import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { invalid } from "./specs";

// SVG path data (docs/motion.md#path-animation, docs/motion.md#shapes): M, L, H, V, C, S, Q, T and Z, absolute and
// relative, parsed strictly into subpaths of cubic Bézier segments. Arcs (A) are E_UNSUPPORTED_OPTION.

export type Point = readonly [x: number, y: number];
/** A cubic Bézier segment from the previous point: its two control points and its end. */
export type Cubic = readonly [x1: number, y1: number, x2: number, y2: number, x: number, y: number];
/** A subpath: where it starts, its segments, and whether it closes back to its start. */
export interface Subpath { start: Point; segments: Cubic[]; closed: boolean }

/** A command letter or a number, after optional whitespace and at most one comma. */
const TOKEN = /\s*(?:,\s*)?(?:([MmLlHhVvCcSsQqTtZzAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))/y;
const line = (from: Point, to: Point): Cubic =>
  [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3, from[0] + 2 * (to[0] - from[0]) / 3, from[1] + 2 * (to[1] - from[1]) / 3, to[0], to[1]];
/** A quadratic Bézier as the cubic that draws it exactly. */
const quadratic = (from: Point, control: Point, to: Point): Cubic =>
  [from[0] + 2 * (control[0] - from[0]) / 3, from[1] + 2 * (control[1] - from[1]) / 3, to[0] + 2 * (control[0] - to[0]) / 3, to[1] + 2 * (control[1] - to[1]) / 3, to[0], to[1]];

function tokenize(d: string, name: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < d.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(d);
    if (!match) {
      const rest = d.slice(at), skipped = rest.length - rest.trimStart().length;
      if (!rest.trim()) break;
      return invalid(`${name} has an unexpected ${JSON.stringify(rest[skipped])} at character ${at + skipped + 1}`);
    }
    tokens.push(match[1] ?? match[2]!);
  }
  return tokens;
}

/** Parses SVG path data into absolute cubic subpaths. Throws E_INVALID_ARGUMENT for malformed data, E_UNSUPPORTED_OPTION for arcs. */
export function parseSvgPath(d: unknown, name: string): Subpath[] {
  if (typeof d !== "string") invalid(`${name} is an SVG path string`);
  const tokens = tokenize(d, name);
  const subpaths: Subpath[] = [];
  let index = 0, command = "", current: Point = [0, 0], cubicControl: Point | undefined, quadControl: Point | undefined;
  let open: Subpath | undefined;
  const number = () => {
    const token = tokens[index++];
    const value = Number(token);
    if (token === undefined || !Number.isFinite(value) || /[a-zA-Z]/.test(token[0]!)) invalid(`${name} needs a number near ${token ?? "its end"}`);
    return value;
  };
  const point = (relative: boolean): Point => { const x = number(), y = number(); return relative ? [current[0] + x, current[1] + y] : [x, y]; };
  const reflect = (control: Point | undefined): Point => control ? [2 * current[0] - control[0], 2 * current[1] - control[1]] : current;
  /** The subpath segments go to: the open one, or (after Z) a new one from where the closed one started. */
  const subpath = () => {
    if (!open) { open = { start: current, segments: [], closed: false }; subpaths.push(open); }
    return open;
  };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index]!)) command = tokens[index++]!;
    else if (!command) invalid(`${name} starts with M`);
    const relative = command === command.toLowerCase(), kind = command.toUpperCase();
    if (!subpaths.length && kind !== "M") invalid(`${name} starts with M`);
    let next: Point, cubic: Point | undefined, quad: Point | undefined;
    switch (kind) {
      case "M":
        current = point(relative);
        open = undefined;
        subpath();
        command = relative ? "l" : "L";  // further pairs are lines
        cubicControl = quadControl = undefined;
        continue;
      case "L": next = point(relative); subpath().segments.push(line(current, next)); break;
      case "H": next = [relative ? current[0] + number() : number(), current[1]]; subpath().segments.push(line(current, next)); break;
      case "V": next = [current[0], relative ? current[1] + number() : number()]; subpath().segments.push(line(current, next)); break;
      case "C": case "S": {
        const c1 = kind === "C" ? point(relative) : reflect(cubicControl);
        cubic = point(relative);
        next = point(relative);
        subpath().segments.push([c1[0], c1[1], cubic[0], cubic[1], next[0], next[1]]);
        break;
      }
      case "Q": case "T": {
        quad = kind === "Q" ? point(relative) : reflect(quadControl);
        next = point(relative);
        subpath().segments.push(quadratic(current, quad, next));
        break;
      }
      case "Z": {
        const closing = subpath();
        next = closing.start;
        if (next[0] !== current[0] || next[1] !== current[1]) closing.segments.push(line(current, next));
        closing.closed = true;
        open = undefined;
        command = "";
        break;
      }
      case "A": throw new SparkError("E_UNSUPPORTED_OPTION", `${name}: arcs (A) are not supported; draw them with cubic curves (C)`);
      default: return invalid(`${name} has an unknown command ${command}`);
    }
    current = next;
    cubicControl = cubic;
    quadControl = quad;
  }
  return subpaths;
}

/** The point of a cubic from `from` at `t`. */
export function cubicAt(from: Point, [x1, y1, x2, y2, x, y]: Cubic, t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return [a * from[0] + b * x1 + c * x2 + e * x, a * from[1] + b * y1 + c * y2 + e * y];
}
