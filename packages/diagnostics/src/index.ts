import { Platform } from "react-native";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopDiagnostics";

/** One frame of the main thread's stack. Image, offset and UUID locate it for offline symbolication. */
export interface HangStackFrame {
  /** The program counter (first frame) or a return address, as hex. */
  address: string;
  /** The loaded binary that contains the address. Absent for an address outside every image (JIT code, a corrupt frame). */
  image?: string;
  /** The image's load address, as hex: `atos -o <image> -l <imageAddress> <address>`. */
  imageAddress?: string;
  /** `address` minus `imageAddress`. */
  imageOffset?: number;
  /** The image's LC_UUID, to match a dSYM. */
  imageUUID?: string;
  /** The nearest symbol the dynamic loader knows. Stripped release builds may name a neighbour or nothing; symbolicate those with the dSYM. */
  symbol?: string;
  symbolOffset?: number;
}
export interface HangReport {
  /**
   * How long the main thread did not respond, in milliseconds: from the ping it left unanswered until
   * it answered. A lower bound; the hang may have begun up to half the threshold before that ping.
   */
  durationMs: number;
  thresholdMs: number;
  /** Wall-clock time of the unanswered ping, in milliseconds since 1970 (as `Date.now()`). */
  startedAt: number;
  /** The main thread's stack once the threshold had passed, innermost frame first. Empty when it could not be read. */
  stack: HangStackFrame[];
}
export interface HangWatchdogOptions {
  /** A main thread that leaves a ping unanswered this long is hanging. Integer milliseconds, 50 to 60000. Default 250. */
  thresholdMs?: number;
  /** Called once per hang, after the main thread recovers. */
  onHang: (report: HangReport) => void;
}

/** macOS only; the Windows implementation is tracked in #304. */
export function getHangWatchdogAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native(): Spec {
  const availability = getHangWatchdogAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "The hang watchdog requires macOS with NativeDesktopDiagnostics installed");
  return Native!;
}
async function command(module: Spec, method: string, args: object): Promise<void> {
  parseNativeResult(await invokeNative(() => module.call(method, JSON.stringify(args))), (value): value is null => value === null);
}
const invalid = (message: string): never => { throw new SparkError("E_INVALID_ARGUMENT", message); };
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const isFrame = (value: unknown): value is HangStackFrame => {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  const optional = (key: string, type: "string" | "number") => frame[key] === undefined || typeof frame[key] === type;
  return typeof frame.address === "string" && optional("image", "string") && optional("imageAddress", "string") && optional("imageOffset", "number")
    && optional("imageUUID", "string") && optional("symbol", "string") && optional("symbolOffset", "number");
};
function hangReport(event: DesktopEvent): HangReport {
  const { durationMs, thresholdMs, startedAt, stack } = event;
  if (![durationMs, thresholdMs, startedAt].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) || !Array.isArray(stack) || !stack.every(isFrame))
    throw new SparkError("E_INVALID_DATA", "Native hang report does not match its contract");
  return { durationMs: durationMs as number, thresholdMs: thresholdMs as number, startedAt: startedAt as number, stack };
}

let sequence = 0;
/**
 * Watches the main thread until `remove()`. A watchdog thread pings the main run loop; when a ping goes
 * unanswered for `thresholdMs`, it samples the main thread's stack, and `onHang` gets the report once
 * the main thread answers. Hangs shorter than the threshold are never reported; hangs longer than
 * 1.5 x the threshold always are. Nothing runs while no watchdog is started. Each watchdog is
 * independent, with its own thread and threshold.
 */
export async function startHangWatchdog(options: HangWatchdogOptions): Promise<AsyncRegistration> {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalid("Expected hang watchdog options");
  for (const key of Object.keys(options)) if (key !== "thresholdMs" && key !== "onHang") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported hang watchdog option: ${key}`);
  const { thresholdMs = 250, onHang } = options;
  if (!integer(thresholdMs, 50, 60000)) invalid("thresholdMs must be an integer from 50 to 60000");
  if (typeof onHang !== "function") invalid("Expected an onHang callback");
  const module = native();
  const owner = `hang-${Date.now()}-${++sequence}`;
  let active = true;
  // Subscribed before the watchdog starts, so no report can arrive unheard.
  const subscription = onDesktopEvent(event => { if (active) onHang(hangReport(event)); }, { types: ["hang"], target: { field: "owner", value: owner } });
  try { await command(module, "startHangWatchdog", { owner, thresholdMs }); }
  catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { active = false; subscription.remove(); }, () => command(module, "stopHangWatchdog", { owner }));
}

/**
 * Blocks the main thread for `durationMs` (integer, 1 to 10000), to check hang reporting end to end.
 * The app does not respond meanwhile; the promise resolves once the main thread is free again.
 */
export async function simulateHang(durationMs: number): Promise<void> {
  if (!integer(durationMs, 1, 10000)) invalid("durationMs must be an integer from 1 to 10000");
  await command(native(), "simulateHang", { durationMs });
}
