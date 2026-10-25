// Perceptual screenshot comparison for goldens (docs/e2e-flows.md#visual-goldens).
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

/** 8-bit RGBA, row-major, not premultiplied. */
export type Image = { width: number; height: number; data: Uint8Array };
/** A rectangle in image pixels. */
export type PixelRect = { x: number; y: number; width: number; height: number };
export type CompareOptions = {
  /** Largest CIEDE2000 colour difference that still counts as the same pixel. */
  tolerance: number;
  /** Regions to ignore. */
  masks: PixelRect[];
};
export type DiffStats = {
  /** Pixels outside every mask. */
  compared: number;
  /** Compared pixels beyond the tolerance that are not anti-aliasing. */
  different: number;
  /** Pixels beyond the tolerance that were tolerated as anti-aliasing. */
  antialiased: number;
  /** `different / compared`, 0-1. */
  ratio: number;
};

export const DEFAULT_TOLERANCE = 2;

export function readPng(file: string): Image {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

export function writePng(file: string, image: Image) {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

// sRGB (D65) to CIELAB. Captures carry their color space; both images come from the same capture path, so their
// values are compared as sRGB.
const LINEAR = Float64Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
type Lab = [number, number, number];
function lab(r: number, g: number, b: number): Lab {
  const [R, G, B] = [LINEAR[r]!, LINEAR[g]!, LINEAR[b]!];
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 (Sharma, Wu and Dalal, 2005). */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180, pow7 = (value: number) => value ** 7, c25 = pow7(25);
  const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(pow7(Cm) / (pow7(Cm) + c25)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360;
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  const chroma = C1 * C2 !== 0;
  let dh = chroma ? h2 - h1 : 0;
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh * rad / 2);
  let hm = h1 + h2;
  if (chroma) hm = Math.abs(h1 - h2) > 180 ? (hm < 360 ? hm + 360 : hm - 360) / 2 : hm / 2;
  const Lm = (L1 + L2) / 2, Cmp = (C1 + C2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T;
  const RT = -2 * Math.sqrt(pow7(Cmp) / (pow7(Cmp) + c25)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  const l = (L2 - L1) / SL, c = (C2 - C1) / SC, h = dH / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

/** A pixel composited over a background gray level (0 or 255). */
function over(data: Uint8Array, index: number, background: number): Lab {
  const alpha = data[index + 3]! / 255, mix = (value: number) => Math.round(value * alpha + background * (1 - alpha));
  return lab(mix(data[index]!), mix(data[index + 1]!), mix(data[index + 2]!));
}
/** The colour difference of one pixel, over white and over black, so alpha changes count too. */
function pixelDelta(a: Uint8Array, b: Uint8Array, index: number): number {
  const white = deltaE2000(over(a, index, 255), over(b, index, 255));
  return a[index + 3] === 255 && b[index + 3] === 255 ? white : Math.max(white, deltaE2000(over(a, index, 0), over(b, index, 0)));
}
const same = (a: Uint8Array, i: number, b: Uint8Array, j: number) => a[i] === b[j] && a[i + 1] === b[j + 1] && a[i + 2] === b[j + 2] && a[i + 3] === b[j + 3];
const luma = (data: Uint8Array, index: number) => {
  const alpha = data[index + 3]! / 255;
  return (0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!) * alpha + 255 * (1 - alpha);
};

/** The 3x3 neighbourhood of (x, y), clipped to the image, without the pixel itself. Edge pixels count one free identical neighbour. */
function* neighbours({ width, height }: Image, x: number, y: number): Generator<[number, number]> {
  for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, height - 1); ny++)
    for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, width - 1); nx++) if (nx !== x || ny !== y) yield [nx, ny];
}
const onEdge = ({ width, height }: Image, x: number, y: number) => x === 0 || y === 0 || x === width - 1 || y === height - 1;

/** More than two neighbours with exactly the pixel's colour: the pixel sits in a flat region. */
function flat(image: Image, x: number, y: number): boolean {
  const index = (y * image.width + x) * 4;
  let count = onEdge(image, x, y) ? 1 : 0;
  for (const [nx, ny] of neighbours(image, x, y)) if (same(image.data, index, image.data, (ny * image.width + nx) * 4) && ++count > 2) return true;
  return false;
}

/**
 * Anti-aliasing test after Vysniauskas, "Anti-aliased Pixel and Intensity Slope Detector" (2009): in `image`, the pixel
 * has at most two identical neighbours, lies strictly between its darkest and brightest neighbour, and one of those
 * extremes sits in a flat region of both images. Such a pixel is an edge blend that rendering may shift by a subpixel.
 */
function antialiased(image: Image, other: Image, x: number, y: number): boolean {
  const index = (y * image.width + x) * 4, center = luma(image.data, index);
  let identical = onEdge(image, x, y) ? 1 : 0, darkest = 0, brightest = 0;
  let dark: [number, number] | undefined, bright: [number, number] | undefined;
  for (const [nx, ny] of neighbours(image, x, y)) {
    const at = (ny * image.width + nx) * 4;
    if (same(image.data, index, image.data, at)) { if (++identical > 2) return false; continue; }
    const delta = luma(image.data, at) - center;
    if (delta < darkest) { darkest = delta; dark = [nx, ny]; } else if (delta > brightest) { brightest = delta; bright = [nx, ny]; }
  }
  if (!dark || !bright) return false;
  return (flat(image, ...dark) && flat(other, ...dark)) || (flat(image, ...bright) && flat(other, ...bright));
}

const RED = [255, 0, 0], YELLOW = [255, 200, 0], MASK = [120, 160, 255];
/**
 * Compares two images of the same size. The diff image shows the expected image faded to light gray, differences in
 * red, tolerated anti-aliasing in yellow and masked regions in blue.
 */
export function compare(actual: Image, expected: Image, options: CompareOptions): { stats: DiffStats; diff: Image } {
  const { width, height } = expected;
  if (actual.width !== width || actual.height !== height) throw new Error(`cannot compare a ${actual.width}x${actual.height} image with a ${width}x${height} one`);
  const masked = new Uint8Array(width * height);
  for (const rect of options.masks) {
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) masked.fill(1, y * width + Math.max(0, rect.x), y * width + Math.min(width, rect.x + rect.width));
  }
  const diff = new Uint8Array(width * height * 4);
  const paint = (pixel: number, [r, g, b]: number[]) => diff.set([r!, g!, b!, 255], pixel * 4);
  let compared = 0, different = 0, tolerated = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, index = pixel * 4;
    if (masked[pixel]) { paint(pixel, MASK); continue; }
    compared++;
    if (!same(actual.data, index, expected.data, index) && pixelDelta(actual.data, expected.data, index) > options.tolerance) {
      if (antialiased(actual, expected, x, y) || antialiased(expected, actual, x, y)) { tolerated++; paint(pixel, YELLOW); } else { different++; paint(pixel, RED); }
      continue;
    }
    const gray = Math.round(255 - (255 - luma(expected.data, index)) * 0.15);
    paint(pixel, [gray, gray, gray]);
  }
  return { stats: { compared, different, antialiased: tolerated, ratio: compared ? different / compared : 0 }, diff: { width, height, data: diff } };
}
