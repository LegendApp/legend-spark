import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability, type SparkErrorCode } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopBiometrics";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

/** The Mac's biometric sensor. `unknown`: a type this SDK does not name. */
export type BiometryType = "touchId" | "none" | "unknown";
/**
 * Whether a policy can be evaluated now: `available`, or why not. `notAvailable`: no sensor (or disabled);
 * `notEnrolled`: no fingerprint; `lockout`: too many failed attempts, until the person enters their password;
 * `passcodeNotSet`: no login password; `disconnected`: the Magic Keyboard with Touch ID is not connected;
 * `notPaired`: no Magic Keyboard with Touch ID is paired.
 */
export type BiometricState = "available" | "notAvailable" | "notEnrolled" | "lockout" | "passcodeNotSet" | "disconnected" | "notPaired";
/** Result of `getBiometricStatus`: the sensor type and whether each policy can be evaluated now. */
export interface BiometricStatus {
  biometryType: BiometryType;
  /** Biometrics alone (fallback `app` or `none`, and the biometry secret accesses). */
  biometrics: BiometricState;
  /** Biometrics or the login password (fallback `password`, and `biometryOrPassword` secrets). */
  password: BiometricState;
}
/**
 * `none` (the default): biometrics only, no fallback button. `password`: macOS also offers the login password, also when
 * biometrics fail, are locked out or are unavailable. `app`: a fallback button (`fallbackLabel`, default "Enter
 * Password") that ends the prompt with `userFallback`, for the app's own sign-in.
 */
export type BiometricFallback = "password" | "app" | "none";
/** Prompt text for `getBiometricSecret`; `BiometricAuthOptions` extends it. */
export interface BiometricPromptOptions {
  /** Required: why the app asks, shown in the prompt ("unlock your vault"). 1–300 characters. */
  reason: string;
  /** The cancel button's title. 1–60 characters. Default: macOS's. */
  cancelLabel?: string;
}
/** Options for `authenticateWithBiometrics`. */
export interface BiometricAuthOptions extends BiometricPromptOptions {
  /** Default `none`: the login password is offered only when this asks for it. */
  fallback?: BiometricFallback;
  /** Fallback `app` only: the fallback button's title. 1–60 characters. */
  fallbackLabel?: string;
  /** Aborting dismisses the prompt (the LAContext is invalidated) and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
/** Outcomes the person (or macOS, for `systemCancel`) chose; they resolve. Everything else rejects a BiometricError. */
export type BiometricOutcome = "userCancel" | "systemCancel" | "userFallback" | "authenticationFailed";
/** Result of `authenticateWithBiometrics`: success, or the outcome the person (or macOS) chose. */
export type BiometricAuthResult = { success: true } | { success: false; reason: BiometricOutcome };
/** `value` is null when there is no secret under the key (then nothing prompts). */
export type BiometricSecretResult = { success: true; value: string | null } | { success: false; reason: Exclude<BiometricOutcome, "userFallback"> };
/** Who may read a secret: biometrics enrolled now (adding or removing a fingerprint makes it unreadable), any enrolled biometrics, or biometrics or the login password. */
export type BiometricSecretAccess = "biometryCurrentSet" | "biometryAny" | "biometryOrPassword";
/** Options for `setBiometricSecret`. */
export interface BiometricSecretOptions {
  /** Default `biometryCurrentSet`. */
  access?: BiometricSecretAccess;
}
/**
 * `BiometricError.reason`. Unavailable states, `notInteractive` and `missingEntitlement` reject E_UNAVAILABLE;
 * `appCancel` rejects E_ABORTED; `invalidContext` rejects E_CLOSED.
 */
export type BiometricErrorReason =
  | Exclude<BiometricState, "available">
  | "notInteractive" | "appCancel" | "invalidContext" | "missingEntitlement";
/** A biometric evaluation that could not run or was ended by the app. `reason` names the LocalAuthentication or Keychain cause. */
export class BiometricError extends SparkError {
  readonly reason: BiometricErrorReason;
  constructor(code: SparkErrorCode, message: string, reason: BiometricErrorReason, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "BiometricError";
    this.reason = reason;
  }
}

const OUTCOMES: readonly BiometricOutcome[] = ["userCancel", "systemCancel", "userFallback", "authenticationFailed"];
const STATES: readonly BiometricState[] = ["available", "notAvailable", "notEnrolled", "lockout", "passcodeNotSet", "disconnected", "notPaired"];
// Every failure reason native can report and the code it rejects with; the person's outcomes resolve instead.
const ERROR_CODES: Record<BiometricErrorReason, SparkErrorCode> = {
  notAvailable: "E_UNAVAILABLE", notEnrolled: "E_UNAVAILABLE", lockout: "E_UNAVAILABLE", passcodeNotSet: "E_UNAVAILABLE",
  disconnected: "E_UNAVAILABLE", notPaired: "E_UNAVAILABLE", notInteractive: "E_UNAVAILABLE", missingEntitlement: "E_UNAVAILABLE",
  appCancel: "E_ABORTED", invalidContext: "E_CLOSED",
};
const FALLBACKS: readonly BiometricFallback[] = ["password", "app", "none"];
const ACCESSES: readonly BiometricSecretAccess[] = ["biometryCurrentSet", "biometryAny", "biometryOrPassword"];

/** macOS only. Windows reports `unsupported-platform` (#389). Whether biometrics can be used now: getBiometricStatus. */
export function getBiometricAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(): Spec {
  const availability = getBiometricAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Biometrics require macOS with NativeDesktopBiometrics installed");
  return Native!;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number) => typeof value === "string" && value.length <= maximum && value.trim().length > 0;
function checkOptions(options: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected biometric options");
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported biometric option: ${key}`);
  return options;
}
function prompt(options: Record<string, unknown>) {
  if (!text(options.reason, 300)) throw new SparkError("E_INVALID_ARGUMENT", "A biometric prompt needs reason: 1–300 characters saying why");
  if (options.cancelLabel !== undefined && !text(options.cancelLabel, 60)) throw new SparkError("E_INVALID_ARGUMENT", "cancelLabel is 1–60 characters");
  return { reason: options.reason as string, cancelLabel: options.cancelLabel as string | undefined };
}
function secretKey(key: unknown): string {
  if (typeof key !== "string" || !/^[A-Za-z0-9_.-]{1,200}$/.test(key)) throw new SparkError("E_INVALID_ARGUMENT", "Secret keys are 1–200 letters, digits, '.', '-' or '_'");
  return key;
}

type Failure = { success: false; reason: string; message: string };
const isFailure = (value: unknown): value is Failure => isRecord(value) && value.success === false && typeof value.reason === "string" && typeof value.message === "string";
/**
 * A native failure: the person's outcomes (when `outcomes` allows them) are results; known environment reasons reject a
 * BiometricError; an outcome the operation cannot have (a Keychain write reporting a cancel) is E_NATIVE.
 */
function failure(value: Failure, outcomes: readonly string[]): { success: false; reason: never } {
  if (outcomes.includes(value.reason)) return { success: false, reason: value.reason as never };
  if (Object.hasOwn(ERROR_CODES, value.reason)) throw new BiometricError(ERROR_CODES[value.reason as BiometricErrorReason], value.message, value.reason as BiometricErrorReason);
  if ((OUTCOMES as readonly string[]).includes(value.reason)) throw new SparkError("E_NATIVE", value.message);
  throw new SparkError("E_INVALID_DATA", `Unknown biometric failure: ${value.reason}`);
}

let prompts = 0;

/** Biometric hardware and whether each policy could be evaluated now. Never prompts. */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  const native = requireAvailable();
  return parseNativeResult(await invokeNative(() => native.call("status", "{}")), (value): value is BiometricStatus =>
    isRecord(value) && ["touchId", "none", "unknown"].includes(value.biometryType as string) && STATES.includes(value.biometrics as BiometricState) && STATES.includes(value.password as BiometricState));
}

/**
 * Asks the person to authenticate with Touch ID (and, only with fallback `password`, their login password). Resolves the
 * person's answer; rejects a BiometricError when it cannot prompt (not enrolled, locked out without the password
 * fallback, no sensor, no password: E_UNAVAILABLE) or the signal aborted it (E_ABORTED), and E_BUSY while another
 * biometric prompt is showing. Call it from a person's action.
 */
export async function authenticateWithBiometrics(options: BiometricAuthOptions): Promise<BiometricAuthResult> {
  const checked = checkOptions(options, ["reason", "cancelLabel", "fallback", "fallbackLabel", "signal"]);
  const { reason, cancelLabel } = prompt(checked);
  const fallback = (checked.fallback ?? "none") as BiometricFallback;
  if (!FALLBACKS.includes(fallback)) throw new SparkError("E_INVALID_ARGUMENT", "fallback is password, app or none");
  if (checked.fallbackLabel !== undefined && fallback !== "app") throw new SparkError("E_UNSUPPORTED_OPTION", "fallbackLabel needs fallback app");
  if (checked.fallbackLabel !== undefined && !text(checked.fallbackLabel, 60)) throw new SparkError("E_INVALID_ARGUMENT", "fallbackLabel is 1–60 characters");
  const signal = checked.signal as AbortSignal | undefined;
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal.addEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  const native = requireAvailable();
  if (signal?.aborted) throw new BiometricError("E_ABORTED", "Biometric authentication was aborted before it started", "appCancel");
  const id = String(++prompts);
  // A cancel that fails leaves the prompt up; the call still settles with the person's answer, so nothing is lost.
  const abort = () => { void invokeNative(() => native.call("cancel", JSON.stringify({ id }))).catch(console.error); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const json = await invokeNative(() => native.call("authenticate", JSON.stringify({ id, reason, cancelLabel, fallback, fallbackLabel: checked.fallbackLabel })));
    const value = parseNativeResult(json, (result): result is { success: true } | Failure => isFailure(result) || (isRecord(result) && result.success === true));
    return value.success ? { success: true } : failure(value, OUTCOMES);
  } finally { signal?.removeEventListener("abort", abort); }
}

/** Stores `value` in the Keychain behind biometry, replacing any secret under `key`. Never prompts. */
export async function setBiometricSecret(key: string, value: string, options: BiometricSecretOptions = {}): Promise<void> {
  const checkedKey = secretKey(key);
  if (typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Secret values are strings");
  const access = checkOptions(options, ["access"]).access ?? "biometryCurrentSet";
  if (!ACCESSES.includes(access as BiometricSecretAccess)) throw new SparkError("E_INVALID_ARGUMENT", "access is biometryCurrentSet, biometryAny or biometryOrPassword");
  const native = requireAvailable();
  const result = parseNativeResult(await invokeNative(() => native.call("setSecret", JSON.stringify({ key: checkedKey, value, access }))), (result): result is null | Failure => result === null || isFailure(result));
  if (result) failure(result, []);
}

/** Reads a secret, prompting as its access requires. Resolves null without a prompt when there is none. */
export async function getBiometricSecret(key: string, options: BiometricPromptOptions): Promise<BiometricSecretResult> {
  const checkedKey = secretKey(key);
  const { reason, cancelLabel } = prompt(checkOptions(options, ["reason", "cancelLabel"]));
  const native = requireAvailable();
  const json = await invokeNative(() => native.call("getSecret", JSON.stringify({ id: String(++prompts), key: checkedKey, reason, cancelLabel })));
  const value = parseNativeResult(json, (result): result is { success: true; value: string | null } | Failure =>
    isFailure(result) || (isRecord(result) && result.success === true && (result.value === null || typeof result.value === "string")));
  return value.success ? { success: true, value: value.value } : failure(value, OUTCOMES.filter(outcome => outcome !== "userFallback"));
}

/** Deletes a secret. Never prompts; resolves also when there is none. */
export async function deleteBiometricSecret(key: string): Promise<void> {
  const checkedKey = secretKey(key);
  const native = requireAvailable();
  const result = parseNativeResult(await invokeNative(() => native.call("deleteSecret", JSON.stringify({ key: checkedKey }))), (result): result is null | Failure => result === null || isFailure(result));
  if (result) failure(result, []);
}
