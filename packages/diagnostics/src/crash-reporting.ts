import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopDiagnostics";
import { isFrame, type StackFrame } from "./stack";

interface CrashReportBase {
  /** `<ms since 1970>-<pid>` for a native crash; JavaScript reports add `-js<n>`. */
  id: string;
  /** When the crash happened, in milliseconds since 1970 (as `Date.now()`). */
  createdAt: number;
  /** Caused by `simulateCrash`. */
  simulated: boolean;
  /** CFBundleShortVersionString and CFBundleVersion of the app that crashed. */
  app: { version: string | null; build: string | null };
}
/** A signal (SIGSEGV, SIGABRT…) or an uncaught Objective-C exception, recorded by the process that crashed and symbolicated on the next launch. */
export interface NativeCrashReport extends CrashReportBase {
  kind: "native";
  signal: "SIGABRT" | "SIGBUS" | "SIGFPE" | "SIGILL" | "SIGSEGV" | "SIGSYS" | "SIGTRAP";
  /** The signal's si_code. */
  signalCode: number;
  /** The address that faulted, as hex: SIGSEGV, SIGBUS, SIGILL and SIGFPE only. */
  faultAddress?: string;
  /** Whether the crashing thread was the main thread. */
  mainThread: boolean;
  /** The uncaught exception that ended the process, when one did. */
  exception?: { name: string; reason: string };
  /** The crashing thread's stack, innermost first, up to 128 frames. */
  stack: StackFrame[];
}
/** An error that reached React Native's global handler as fatal. */
export interface JavaScriptCrashReport extends CrashReportBase {
  kind: "javascript";
  fatal: true;
  name: string;
  message: string;
  /** The engine's stack trace, as `error.stack` had it. */
  stack?: string;
}
export type CrashReport = NativeCrashReport | JavaScriptCrashReport;
/** How `simulateCrash` crashes: native kinds crash a helper process, "javascript" records a real TypeError through the JavaScript handler. */
export type SimulatedCrashKind = "badAccess" | "abort" | "uncaughtException" | "trap" | "stackOverflow" | "javascript";
const KINDS: readonly string[] = ["badAccess", "abort", "uncaughtException", "trap", "stackOverflow", "javascript"];
const SIGNALS: readonly string[] = ["SIGABRT", "SIGBUS", "SIGFPE", "SIGILL", "SIGSEGV", "SIGSYS", "SIGTRAP"];

/** macOS only; the Windows implementation is tracked in #343. */
export function getCrashReportingAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native(): Spec {
  const availability = getCrashReportingAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Crash reporting requires macOS with NativeDesktopDiagnostics installed");
  return Native!;
}
async function request<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  const module = native();
  return parseNativeResult(await invokeNative(() => module.call(method, JSON.stringify(args))), validate);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
function isCrashReport(value: unknown): value is CrashReport {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "number" || typeof value.simulated !== "boolean"
    || !isRecord(value.app) || !nullableString(value.app.version) || !nullableString(value.app.build)) return false;
  if (value.kind === "javascript")
    return value.fatal === true && typeof value.name === "string" && typeof value.message === "string" && (value.stack === undefined || typeof value.stack === "string");
  const exception = value.exception;
  return value.kind === "native" && SIGNALS.includes(value.signal as string) && typeof value.signalCode === "number" && typeof value.mainThread === "boolean"
    && (value.faultAddress === undefined || typeof value.faultAddress === "string")
    && (exception === undefined || (isRecord(exception) && typeof exception.name === "string" && typeof exception.reason === "string"))
    && Array.isArray(value.stack) && value.stack.every(isFrame);
}
const isReports = (value: unknown): value is CrashReport[] => Array.isArray(value) && value.every(isCrashReport);

/** Whether the user agreed to crash reporting. Off until the app turns it on; kept in the app's defaults across launches. */
export async function getCrashReportingConsent(): Promise<boolean> {
  return request("getConsent", {}, (value): value is boolean => typeof value === "boolean");
}
/**
 * Records the user's choice. On: crash handlers are installed at once and at every later launch, and
 * fatal JavaScript errors are recorded. Off: nothing is recorded (handlers already installed only pass
 * crashes on); existing reports stay until `deleteCrashReports`.
 */
export async function setCrashReportingConsent(granted: boolean): Promise<void> {
  if (typeof granted !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected consent as a boolean");
  await request("setConsent", { granted }, (value): value is null => value === null);
}
/**
 * The reports on this Mac, newest first. Records left by crashed processes become reports here (and at
 * each launch), symbolicated with the symbols of the same binaries loaded in this process. Nothing is sent anywhere.
 */
export async function getCrashReports(): Promise<CrashReport[]> {
  return request("getReports", {}, isReports);
}
/** Deletes the reports with these ids (unknown ids are ignored), or every report when `ids` is omitted. */
export async function deleteCrashReports(ids?: string[]): Promise<void> {
  if (ids !== undefined && (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && /^[0-9a-z-]{1,64}$/.test(id)))) throw new SparkError("E_INVALID_ARGUMENT", "Expected crash report ids");
  await request("deleteReports", ids === undefined ? {} : { ids }, (value): value is null => value === null);
}

/** Writes a fatal JavaScript error's report before React Native's handler runs. Returns its id, or null without consent. */
function recordFatal(module: Spec, error: unknown, simulated: boolean): string | null {
  const value = error instanceof Error ? error : new Error(String(error));
  const id = module.recordJavaScriptError(JSON.stringify({ fatal: true, simulated, name: value.name, message: value.message, ...(typeof value.stack === "string" ? { stack: value.stack } : {}) }));
  return id || null;
}
// In front of React Native's global handler once this module loads on macOS: fatal errors are recorded
// (natively, only with consent), then handed on unchanged. Non-fatal errors only pass through.
if (getCrashReportingAvailability().available && typeof ErrorUtils !== "undefined") {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      try { recordFatal(Native!, error, false); }
      catch (cause) { console.error(new SparkError("E_NATIVE", "Could not record a fatal JavaScript error", { cause })); }
    }
    previous(error, isFatal);
  });
}

// A real TypeError from the engine, thrown by a named function so its stack names it.
function sparkSimulatedJavaScriptCrash(): never {
  const missing: { crash(): never } | undefined = undefined;
  return (missing as unknown as { crash(): never }).crash();
}

/**
 * Crashes in the given way, without ending the app, and resolves with the report. Native kinds start
 * this app's executable again as a helper process that installs the handlers and crashes before the
 * app starts (no window, nothing sent anywhere); "javascript" throws a TypeError and records it as the
 * global handler would, without passing it on. Requires consent: rejects E_PERMISSION_DENIED otherwise.
 */
export async function simulateCrash(kind: SimulatedCrashKind): Promise<CrashReport> {
  if (!KINDS.includes(kind)) throw new SparkError("E_INVALID_ARGUMENT", `Expected one of ${KINDS.join(", ")}`);
  const module = native();
  if (!await getCrashReportingConsent()) throw new SparkError("E_PERMISSION_DENIED", "Crash reporting is off: the user has not consented");
  if (kind !== "javascript") return request("simulateCrash", { kind }, isCrashReport);
  let id: string | null = null;
  try { sparkSimulatedJavaScriptCrash(); }
  catch (error) { id = recordFatal(module, error, true); }
  const report = id ? (await getCrashReports()).find(candidate => candidate.id === id) : undefined;
  if (!report) throw new SparkError("E_NATIVE", "The simulated JavaScript crash was not recorded");
  return report;
}
