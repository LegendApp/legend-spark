import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { availability, checkOptions, isRecord, nullableText, perform, requireNative, text, failure, type AuthorizationAvailability } from "./shared";
export { AuthorizationError, type AuthorizationAvailability, type AuthorizationErrorReason } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

export type AppleAuthenticationScope = "fullName" | "email";
export interface AppleSignInOptions {
  /** What to ask the person to share. Apple returns them only the first time the person signs in to the app. */
  scopes?: AppleAuthenticationScope[];
  /** Returned unchanged in the credential, to match the response to the request. 1–1024 characters. */
  state?: string;
  /**
   * Replay protection. Pass the SHA-256 (hex) of a fresh random raw nonce, never the raw value; Apple embeds it in the
   * identity token. Send the raw nonce to your server, which checks the token's nonce claim equals its SHA-256
   * (docs/authentication.md#verifying-on-your-server). 1–1024 characters.
   */
  nonce?: string;
  /** The window to present over (useWindowId(); "main" for the main window). Default: the key window. */
  windowId?: string;
  /** Aborting cancels the sheet and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
export interface AppleIDFullName {
  namePrefix: string | null; givenName: string | null; middleName: string | null;
  familyName: string | null; nameSuffix: string | null; nickname: string | null;
}
export interface AppleIDCredential {
  /** Stable for this person and your team: the account identifier to store. */
  user: string;
  state: string | null;
  authorizedScopes: AppleAuthenticationScope[];
  /** A JSON Web Token for your server to verify with Apple. */
  identityToken: string | null;
  /** A short-lived code for your server to exchange with Apple. */
  authorizationCode: string | null;
  /** First sign-in with the email scope only; may be a private relay address. */
  email: string | null;
  /** First sign-in with the fullName scope only. */
  fullName: AppleIDFullName | null;
  realUserStatus: "likelyReal" | "unknown" | "unsupported";
}
export type AppleSignInResult = { type: "success"; credential: AppleIDCredential } | { type: "cancel" };
export type AppleIDCredentialState = "authorized" | "revoked" | "notFound" | "transferred";

const SCOPES: readonly AppleAuthenticationScope[] = ["fullName", "email"];
const STATES: readonly AppleIDCredentialState[] = ["authorized", "revoked", "notFound", "transferred"];
const NAME_KEYS = ["namePrefix", "givenName", "middleName", "familyName", "nameSuffix", "nickname"] as const;
function isCredential(value: unknown): value is AppleIDCredential {
  return isRecord(value) && typeof value.user === "string" && nullableText(value.state) && nullableText(value.identityToken)
    && nullableText(value.authorizationCode) && nullableText(value.email) && ["likelyReal", "unknown", "unsupported"].includes(value.realUserStatus as string)
    && Array.isArray(value.authorizedScopes) && value.authorizedScopes.every(scope => SCOPES.includes(scope))
    && (value.fullName === null || (isRecord(value.fullName) && NAME_KEYS.every(key => nullableText((value.fullName as Record<string, unknown>)[key]))));
}

/**
 * macOS only; Windows reports `unsupported-platform` (#423). `missing-entitlement` until the app is built with
 * `macos.authentication.signInWithApple` and signed by its team with a provisioning profile (docs/authentication.md).
 */
export function getAppleAuthenticationAvailability(): AuthorizationAvailability { return availability("appleId"); }

/**
 * Shows the Sign in with Apple sheet over the window. Resolves the credential, or `{ type: "cancel" }` when the person
 * cancels; rejects an AuthorizationError (missingEntitlement before anything shows, or AuthenticationServices' failure),
 * E_BUSY while another authorization request is showing and E_NOT_FOUND without a window. Call it from a person's action.
 */
export async function signInWithApple(options: AppleSignInOptions = {}): Promise<AppleSignInResult> {
  const checked = checkOptions(options, ["scopes", "state", "nonce", "windowId", "signal"]);
  const scopes = checked.scopes ?? [];
  if (!Array.isArray(scopes) || new Set(scopes).size !== scopes.length || !scopes.every(scope => SCOPES.includes(scope))) throw new SparkError("E_INVALID_ARGUMENT", "scopes lists fullName and email at most once each");
  for (const key of ["state", "nonce"] as const) if (checked[key] !== undefined && !text(checked[key], 1024)) throw new SparkError("E_INVALID_ARGUMENT", `${key} is 1–1024 characters`);
  return perform("appleId", { scopes, state: checked.state, nonce: checked.nonce }, checked, isCredential);
}

/**
 * Whether the Apple ID `user` (from a credential) is still authorized for this app. Apple's servers answer; call it at
 * launch and sign the person out when it is not `authorized`. Rejects missingEntitlement like signInWithApple.
 */
export async function getAppleIDCredentialState(user: string): Promise<AppleIDCredentialState> {
  if (!text(user, 1024)) throw new SparkError("E_INVALID_ARGUMENT", "user is the credential's user identifier, 1–1024 characters");
  const native = requireNative();
  const value = parseNativeResult(await invokeNative(() => native.call("credentialState", JSON.stringify({ user }))), (result): result is AppleIDCredentialState | { type: "failure"; reason: string; message: string } =>
    STATES.includes(result as AppleIDCredentialState) || (isRecord(result) && result.type === "failure" && typeof result.reason === "string" && typeof result.message === "string"));
  return typeof value === "string" ? value : failure(value.reason, value.message);
}
