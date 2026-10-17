import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability, type SparkErrorCode } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopAuthentication";
import type { AppleAuthenticationScope, AppleIDCredential } from "./apple";

/**
 * Availability of Sign in with Apple or passkeys. `missing-entitlement`: this build is not signed with the entitlement
 * the feature needs (docs/authentication.md#entitlements); a request would fail without showing anything.
 */
export type AuthorizationAvailability = Availability | { available: false; reason: "missing-entitlement" };
/**
 * Why an authorization request failed (the person's cancel resolves `{ type: "cancel" }` instead). `missingEntitlement`,
 * `notInteractive`, `notHandled`, `failed` and `deviceNotConfigured`: E_UNAVAILABLE; `matchedExcludedCredential`:
 * E_ALREADY_EXISTS; `invalidResponse`: E_INVALID_DATA; `appCancel` (the signal aborted): E_ABORTED; `unknown`: E_NATIVE.
 */
export type AuthorizationErrorReason =
  | "missingEntitlement" | "notInteractive" | "notHandled" | "failed" | "deviceNotConfigured"
  | "matchedExcludedCredential" | "invalidResponse" | "appCancel" | "unknown";
/** An authorization request that AuthenticationServices failed or the app ended. `reason` names the ASAuthorizationError. */
export class AuthorizationError extends SparkError {
  readonly reason: AuthorizationErrorReason;
  constructor(code: SparkErrorCode, message: string, reason: AuthorizationErrorReason, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}
const ERROR_CODES: Record<AuthorizationErrorReason, SparkErrorCode> = {
  missingEntitlement: "E_UNAVAILABLE", notInteractive: "E_UNAVAILABLE", notHandled: "E_UNAVAILABLE", failed: "E_UNAVAILABLE",
  deviceNotConfigured: "E_UNAVAILABLE", matchedExcludedCredential: "E_ALREADY_EXISTS", invalidResponse: "E_INVALID_DATA",
  appCancel: "E_ABORTED", unknown: "E_NATIVE",
};

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum && value.trim().length > 0;
export const nullableText = (value: unknown) => value === null || typeof value === "string";

/** macOS only; Windows reports `unsupported-platform` (#423). `host-restriction`: this macOS lacks `passkeyFeature`. */
export function availability(feature: "appleId" | "passkeys", relyingPartyId?: string, passkeyFeature?: string): AuthorizationAvailability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  const answer = Native.availability(JSON.stringify({ feature, relyingPartyId, passkeyFeature }));
  if (answer === "available") return { available: true };
  if (answer === "missing-entitlement" || answer === "host-restriction") return { available: false, reason: answer };
  throw new SparkError("E_INVALID_DATA", `Unknown authorization availability: ${answer}`);
}
export function requireNative(): Spec {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Sign in with Apple and passkeys require macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Sign in with Apple and passkeys require NativeDesktopAuthentication");
  return Native;
}

export function checkOptions(options: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected authorization options");
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported authorization option: ${key}`);
  if (options.windowId !== undefined && (typeof options.windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid windowId");
  const signal = options.signal as AbortSignal | undefined;
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal.addEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  return options;
}

/** A failure native reported as a result: a known reason rejects an AuthorizationError; anything else is E_INVALID_DATA. */
export function failure(reason: string, message: string): never {
  if (Object.hasOwn(ERROR_CODES, reason)) throw new AuthorizationError(ERROR_CODES[reason as AuthorizationErrorReason], message, reason as AuthorizationErrorReason);
  throw new SparkError("E_INVALID_DATA", `Unknown authorization failure: ${reason}`);
}

const SCOPES: readonly AppleAuthenticationScope[] = ["fullName", "email"];
const NAME_KEYS = ["namePrefix", "givenName", "middleName", "familyName", "nameSuffix", "nickname"] as const;
export function isAppleIDCredential(value: unknown): value is AppleIDCredential {
  return isRecord(value) && typeof value.user === "string" && nullableText(value.state) && nullableText(value.identityToken)
    && nullableText(value.authorizationCode) && nullableText(value.email) && ["likelyReal", "unknown", "unsupported"].includes(value.realUserStatus as string)
    && Array.isArray(value.authorizedScopes) && value.authorizedScopes.every(scope => SCOPES.includes(scope))
    && (value.fullName === null || (isRecord(value.fullName) && NAME_KEYS.every(key => nullableText((value.fullName as Record<string, unknown>)[key]))));
}
/** A Sign in with Apple request's checked scopes, state and nonce, as native takes them. */
export function appleIdRequest(options: Record<string, unknown>) {
  const scopes = options.scopes ?? [];
  if (!Array.isArray(scopes) || new Set(scopes).size !== scopes.length || !scopes.every(scope => SCOPES.includes(scope))) throw new SparkError("E_INVALID_ARGUMENT", "scopes lists fullName and email at most once each");
  for (const key of ["state", "nonce"] as const) if (options[key] !== undefined && !text(options[key], 1024)) throw new SparkError("E_INVALID_ARGUMENT", `${key} is 1–1024 characters`);
  return { scopes, state: options.state, nonce: options.nonce };
}

let requests = 0;
/**
 * Runs one AuthenticationServices request: `{ type: "success", credential }` (validated by `isCredential`) or
 * `{ type: "cancel" }`; failures reject. Aborting `signal` cancels the controller, which rejects E_ABORTED appCancel.
 */
export async function perform<T>(operation: string, request: Record<string, unknown>, options: Record<string, unknown>, isCredential: (value: unknown) => value is T): Promise<{ type: "success"; credential: T } | { type: "cancel" }> {
  const native = requireNative();
  const signal = options.signal as AbortSignal | undefined;
  if (signal?.aborted) throw new AuthorizationError("E_ABORTED", "The authorization request was aborted before it started", "appCancel");
  const id = String(++requests);
  // A cancel that fails leaves the sheet up; the call still settles with the person's answer, so nothing is lost.
  const abort = () => { void invokeNative(() => native.call("cancel", JSON.stringify({ id }))).catch(console.error); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const json = await invokeNative(() => native.call("perform", JSON.stringify({ ...request, id, operation, windowId: options.windowId })));
    const value = parseNativeResult(json, (result): result is { type: "success"; credential: T } | { type: "cancel" } | { type: "failure"; reason: string; message: string } =>
      isRecord(result) && ((result.type === "success" && isCredential(result.credential)) || result.type === "cancel"
        || (result.type === "failure" && typeof result.reason === "string" && typeof result.message === "string")));
    if (value.type === "failure") failure(value.reason, value.message);
    return value.type === "success" ? { type: "success", credential: value.credential } : { type: "cancel" };
  } finally { signal?.removeEventListener("abort", abort); }
}
