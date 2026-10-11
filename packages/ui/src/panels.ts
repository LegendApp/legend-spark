import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { hexColor } from "./primitives";
import { getPanelsNative, onPanelEvent } from "./panel-host";

/** The system color panel's picker pages. */
export type ColorPanelMode = "wheel" | "rgb" | "hsb" | "cmyk" | "gray" | "palettes" | "image" | "pencils";
export interface PanelCloseEvent { reason: "dismissed" | "replaced" }
/** A shared system panel shown for one caller. `close()` stops callbacks at once and hides the panel if this session still owns it. */
export interface PanelSession { close(): Promise<void> }
export interface ColorPanelChangeEvent { color: string }
export interface ColorPanelOptions {
  /** sRGB hex; omitted keeps the panel's color. */
  color?: string;
  /** Shows the opacity slider; reported colors then carry an alpha byte. Default false. */
  alpha?: boolean;
  /** Omitted keeps the user's last page. */
  mode?: ColorPanelMode;
  onChange: (event: ColorPanelChangeEvent) => void;
  /** The user closed the panel, or another session or a ColorWell took it over. */
  onClose?: (event: PanelCloseEvent) => void;
}
export type ScreenColorResult = { canceled: true } | { canceled: false; color: string };
export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export interface FontDescriptor {
  family: string;
  /** Points. */
  size: number;
  /** Default 400; the nearest installed weight is used. */
  weight?: FontWeight;
  italic?: boolean;
}
/** An installed font, as the system resolved it. */
export interface ResolvedFont { family: string; postScriptName: string; size: number; weight: FontWeight; italic: boolean }
export interface FontPanelChangeEvent { font: ResolvedFont }
export interface FontPanelOptions {
  font: FontDescriptor;
  onChange: (event: FontPanelChangeEvent) => void;
  onClose?: (event: PanelCloseEvent) => void;
}
export interface FontPanelSession extends PanelSession {
  /** The installed font the panel opened with. */
  readonly font: ResolvedFont;
}

const MODES: readonly ColorPanelMode[] = ["wheel", "rgb", "hsb", "cmyk", "gray", "palettes", "image", "pencils"];
const WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];
type Panel = "colorPanel" | "fontPanel";

function availability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return getPanelsNative() ? { available: true } : { available: false, reason: "missing-module" };
}
/** `sampler` is the screen eyedropper (`sampleScreenColor`). It needs no Screen Recording permission: the system samples out of process and returns only the chosen color. */
export function getColorPanelAvailability(feature?: "sampler"): Availability {
  if (feature !== undefined && feature !== "sampler") throw new SparkError("E_INVALID_ARGUMENT", "Unknown color panel feature");
  return availability();
}
export function getFontPanelAvailability(): Availability { return availability(); }

async function call(method: string, args: object): Promise<unknown> {
  const available = availability();
  if (!available.available) throw new SparkError(available.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "System panels are unavailable");
  const native = getPanelsNative()!;
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), (value): value is unknown => value !== undefined);
}
function options(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} options`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${name} option: ${key}`);
  return value as Record<string, unknown>;
}
function callbacks(value: Record<string, unknown>) {
  if (typeof value.onChange !== "function" || (value.onClose !== undefined && typeof value.onClose !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected onChange and optional onClose callbacks");
}
function isResolvedFont(value: unknown): value is ResolvedFont {
  const font = value as ResolvedFont;
  return !!font && typeof font === "object" && typeof font.family === "string" && typeof font.postScriptName === "string" && Number.isFinite(font.size) && font.size > 0 && WEIGHTS.includes(font.weight) && typeof font.italic === "boolean";
}
function invalidEvent(panel: Panel) { console.error(new SparkError("E_INVALID_DATA", `Invalid native ${panel} event`)); }

let sequence = 0;
/** One session per show: listen first, then show, so no change or close is lost. */
async function open(panel: Panel, args: object, change: (event: DesktopEvent) => void, onClose?: (event: PanelCloseEvent) => void) {
  const sessionId = `${panel}-${Date.now()}-${++sequence}`;
  let active = true;
  const subscription = onPanelEvent(event => {
    if (!active) return;
    if (event.type === `${panel}Change`) { change(event); return; }
    if (event.reason !== "dismissed" && event.reason !== "replaced") { invalidEvent(panel); return; }
    active = false; subscription.remove(); onClose?.({ reason: event.reason });
  }, { types: [`${panel}Change`, `${panel}Close`], target: { field: "sessionId", value: sessionId } });
  let shown: unknown;
  try { shown = await call(`${panel}.show`, { ...args, sessionId }); }
  catch (error) { active = false; subscription.remove(); throw error; }
  // A session the user or a newer owner already ended closes nothing natively.
  const registration = asyncRegistration(() => { if (active) { active = false; subscription.remove(); } }, async () => { await call(`${panel}.close`, { sessionId }); });
  return { shown, close: registration.remove };
}

/** Shows the system color panel; each color the user picks arrives through `onChange`. */
export async function showColorPanel(value: ColorPanelOptions): Promise<PanelSession> {
  const given = options(value, ["color", "alpha", "mode", "onChange", "onClose"], "color panel");
  callbacks(given);
  const alpha = given.alpha ?? false;
  if (typeof alpha !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected a boolean alpha");
  if (given.mode !== undefined && !MODES.includes(given.mode as ColorPanelMode)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown color panel mode");
  const color = given.color === undefined ? "" : hexColor(given.color, alpha);
  const { onChange, onClose } = value;
  const { close } = await open("colorPanel", { color, alpha, mode: given.mode ?? "" }, event => {
    let reported: string;
    try { reported = hexColor(event.color, alpha, true); } catch { invalidEvent("colorPanel"); return; }
    onChange({ color: reported });
  }, onClose);
  return { close };
}

/** The system eyedropper: the user picks one on-screen color, or cancels with Escape. */
export async function sampleScreenColor(): Promise<ScreenColorResult> {
  const result = await call("sampleScreenColor", {}) as ScreenColorResult;
  if (result?.canceled === true && Object.keys(result).length === 1) return { canceled: true };
  if (result?.canceled === false) { try { return { canceled: false, color: hexColor(result.color, false) }; } catch { /* reported below */ } }
  throw new SparkError("E_INVALID_DATA", "Native sampler result does not match its contract");
}

/** Shows the system font panel for `font`; each font the user picks arrives through `onChange`. */
export async function showFontPanel(value: FontPanelOptions): Promise<FontPanelSession> {
  const given = options(value, ["font", "onChange", "onClose"], "font panel");
  callbacks(given);
  const font = options(given.font, ["family", "size", "weight", "italic"], "font");
  if (typeof font.family !== "string" || !font.family.trim() || font.family.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected a font family");
  if (typeof font.size !== "number" || !Number.isFinite(font.size) || font.size <= 0 || font.size > 10000) throw new SparkError("E_INVALID_ARGUMENT", "Expected a positive font size in points");
  if (font.weight !== undefined && !WEIGHTS.includes(font.weight as number)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a font weight from 100 to 900 in steps of 100");
  if (font.italic !== undefined && typeof font.italic !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected a boolean italic");
  const { onChange, onClose } = value;
  const { shown, close } = await open("fontPanel", { family: font.family, size: font.size, weight: font.weight ?? 400, italic: font.italic ?? false }, event => {
    if (!isResolvedFont(event.font)) { invalidEvent("fontPanel"); return; }
    onChange({ font: event.font });
  }, onClose);
  if (!isResolvedFont(shown)) { await close(); throw new SparkError("E_INVALID_DATA", "Native font panel result does not match its contract"); }
  return { font: shown, close };
}
