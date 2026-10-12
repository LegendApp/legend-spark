import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";

// Colors animate in OKLCH (docs/motion.md#colors). JavaScript parses a color once and sends its four components;
// the native engine animates each one and converts them back to extended sRGB for every sample.

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, `oklch()` or `transparent`. */
export type MotionColor = string;
/** OKLCH: lightness 0-1, chroma (0 is gray), hue in degrees, alpha 0-1. */
export type Oklch = readonly [lightness: number, chroma: number, hue: number, alpha: number];
/** The engine's components of a color property. */
export const COLOR_COMPONENTS = ["backgroundColorL", "backgroundColorC", "backgroundColorH", "backgroundColorAlpha"] as const;
export type ColorComponent = typeof COLOR_COMPONENTS[number];
/** Below this chroma a color is gray (its hue does not show); below this alpha it is transparent. The engine uses the same threshold. */
const INVISIBLE = 0.0005;

const invalid = (message: string): never => { throw new SparkError("E_INVALID_ARGUMENT", message); };
const RULE = "a color: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), oklch() or transparent";

function channel(text: string, scale: number, name: string): number {
  const percent = text.endsWith("%");
  const value = Number(percent ? text.slice(0, -1) : text);
  if (!text || !Number.isFinite(value)) invalid(`${name} has an invalid component ${text}`);
  return percent ? value / 100 : value / scale;
}
/** The arguments of `name(a b c / d)` or `name(a, b, c, d)`. */
function args(value: string, name: string): string[] {
  const body = value.slice(value.indexOf("(") + 1, -1).trim();
  const parts = body.includes(",") ? body.split(",").map(part => part.trim()) : body.replace("/", " / ").split(/\s+/).filter(part => part && part !== "/");
  if (parts.length !== 3 && parts.length !== 4) invalid(`${name} takes three components and an optional alpha`);
  return parts;
}

function fromSrgb(red: number, green: number, blue: number, alpha: number): Oklch {
  // Björn Ottosson's OKLab, from linear sRGB.
  const linear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [red, green, blue].map(c => linear(Math.min(Math.max(c, 0), 1))) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const chroma = Math.hypot(a, bb);
  return [lightness, chroma, chroma < INVISIBLE ? 0 : (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360, Math.min(Math.max(alpha, 0), 1)];
}

/** Parses a color into OKLCH. Throws E_INVALID_ARGUMENT for anything else (named colors other than transparent, platform colors). */
export function parseColor(value: unknown, name = "A color"): Oklch {
  if (typeof value !== "string") return invalid(`${name} must be ${RULE}`);
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map(digit => digit + digit) : hex.match(/../g)!;
    const [r, g, b, a = 255] = digits.map(pair => parseInt(pair, 16)) as [number, number, number, number?];
    return fromSrgb(r / 255, g / 255, b / 255, a / 255);
  }
  if (/^rgba?\(.*\)$/.test(text)) {
    const [r, g, b, a = "1"] = args(text, name) as [string, string, string, string?];
    return fromSrgb(channel(r, 255, name), channel(g, 255, name), channel(b, 255, name), channel(a, 1, name));
  }
  if (/^oklch\(.*\)$/.test(text)) {
    const [l, c, h, a = "1"] = args(text, name) as [string, string, string, string?];
    const chroma = channel(c, 1 / 0.4, name);  // 100% chroma is 0.4
    const hue = h === "none" ? 0 : Number(h.replace(/deg$/, ""));
    if (!Number.isFinite(hue)) invalid(`${name} has an invalid hue ${h}`);
    return [Math.min(Math.max(channel(l, 1, name), 0), 1), Math.max(chroma, 0), ((hue % 360) + 360) % 360, Math.min(Math.max(channel(a, 1, name), 0), 1)];
  }
  return invalid(`${name} must be ${RULE}`);
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));
/** CSS `oklch(L C H / A)`, as motion state reports colors. */
export function formatColor([lightness, chroma, hue, alpha]: readonly number[]): MotionColor {
  return `oklch(${round(lightness, 4)} ${round(chroma, 4)} ${round(((hue! % 360) + 360) % 360, 2)} / ${round(alpha!, 4)})`;
}

/**
 * The components of a list of color stops, ready to interpolate in OKLCH: a transparent stop takes the lightness,
 * chroma and hue of the nearest visible stop before it (after it for leading ones), a gray stop the hue of the nearest
 * colored one, and each hue is unwrapped to the shorter way round from the previous stop. A component that never shows
 * is left out (null): the hue of all-gray stops, and everything but alpha of all-transparent stops, so the engine keeps
 * what it has.
 */
export function colorStops(stops: readonly Oklch[]): Record<ColorComponent, number[] | null> {
  const nearest = (index: number, visible: (stop: Oklch) => boolean) => {
    for (let i = index; i >= 0; i--) if (visible(stops[i]!)) return stops[i]!;
    for (let i = index + 1; i < stops.length; i++) if (visible(stops[i]!)) return stops[i]!;
    return undefined;
  };
  const opaque = (stop: Oklch) => stop[3] >= INVISIBLE, colored = (stop: Oklch) => opaque(stop) && stop[1] >= INVISIBLE;
  const shown = stops.map((stop, index) => opaque(stop) ? stop : nearest(index, opaque));
  const hues = stops.map((_, index) => nearest(index, colored)?.[2]);
  for (let i = 1; i < hues.length; i++) if (hues[i] !== undefined && hues[i - 1] !== undefined) hues[i] = hues[i - 1]! + ((((hues[i]! - hues[i - 1]!) % 360) + 540) % 360 - 180);
  const anyShown = shown[0] !== undefined;
  return {
    backgroundColorL: anyShown ? shown.map(stop => stop![0]) : null,
    backgroundColorC: anyShown ? shown.map(stop => stop![1]) : null,
    backgroundColorH: hues[0] === undefined ? null : hues as number[],
    backgroundColorAlpha: stops.map(stop => stop[3]),
  };
}

/** A color as engine values: all four components (a value that is set does not interpolate). */
export function colorValues(value: unknown, name: string): Record<ColorComponent, number> {
  const [l, c, h, alpha] = parseColor(value, name);
  return { backgroundColorL: l, backgroundColorC: c, backgroundColorH: h, backgroundColorAlpha: alpha };
}
