import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { availability, checkOptions, isRecord, perform, text, type AuthorizationAvailability } from "./shared";
export { AuthorizationError, type AuthorizationAvailability, type AuthorizationErrorReason } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

/**
 * Binary values (challenge, user ID, credential IDs and the authenticator's responses) are unpadded base64url strings,
 * as in WebAuthn's JSON serialization (`PublicKeyCredential.toJSON()`), so they pass to and from a server unchanged.
 */
export type Base64URLString = string;
/** How strongly the authenticator must verify the person (WebAuthn user verification). */
export type PasskeyUserVerification = "required" | "preferred" | "discouraged";
interface PasskeyRequestOptions {
  /** The relying party's domain (example.com): the app must be entitled to webcredentials:<it>, and it must list the app. */
  relyingPartyId: string;
  /** From your server, 16–1024 bytes. */
  challenge: Base64URLString;
  /** Default `preferred`. */
  userVerification?: PasskeyUserVerification;
  /** The window to present over (useWindowId(); "main" for the main window). Default: the key window. */
  windowId?: string;
  /** Aborting cancels the sheet and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
/** Options for `createPasskey` (macOS only). */
export interface PasskeyRegistrationOptions extends PasskeyRequestOptions {
  /** The user handle, 1–64 bytes; never personal data. */
  userId: Base64URLString;
  /** The account name shown in the sheet and in Passwords. 1–256 characters. */
  userName: string;
  /** 1–256 characters. */
  displayName?: string;
  /** Default `none`. */
  attestation?: "none" | "direct" | "indirect" | "enterprise";
  /** Credential IDs the account already has; one of them on this Mac rejects E_ALREADY_EXISTS. macOS 15 and later. */
  excludeCredentials?: Base64URLString[];
}
/** Options for `getPasskey` (macOS only). */
export interface PasskeyAssertionOptions extends PasskeyRequestOptions {
  /** Only these credentials may answer. Default: any passkey for the relying party. */
  allowCredentials?: Base64URLString[];
}
/** A new passkey from `createPasskey`, for your server to verify and store. */
export interface PasskeyRegistration {
  credentialId: Base64URLString;
  clientDataJSON: Base64URLString;
  /** CBOR attestation object; null when the authenticator returns none. */
  attestationObject: Base64URLString | null;
}
/** A passkey assertion from `getPasskey`, for your server to verify against the stored public key. */
export interface PasskeyAssertion {
  credentialId: Base64URLString;
  /** The user handle given when the passkey was created. */
  userId: Base64URLString;
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
}
/** Result of `createPasskey`: the registration, or `cancel` when the person cancels. */
export type PasskeyRegistrationResult = { type: "success"; credential: PasskeyRegistration } | { type: "cancel" };
/** Result of `getPasskey`: the assertion, or `cancel` when the person cancels. */
export type PasskeyAssertionResult = { type: "success"; credential: PasskeyAssertion } | { type: "cancel" };

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const isBase64URL = (value: unknown): value is string => typeof value === "string" && BASE64URL.test(value) && value.length % 4 !== 1;
/** Decoded length of unpadded base64url. */
const bytes = (value: string) => Math.floor(value.length * 3 / 4);
const RELYING_PARTY = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function binary(value: unknown, name: string, minimum: number, maximum: number): string {
  if (!isBase64URL(value) || bytes(value) < minimum || bytes(value) > maximum) throw new SparkError("E_INVALID_ARGUMENT", `${name} is ${minimum}–${maximum} bytes as unpadded base64url`);
  return value;
}
function credentials(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) throw new SparkError("E_INVALID_ARGUMENT", `${name} lists at most 64 base64url credential IDs`);
  return value.map(id => binary(id, `Each of ${name}`, 1, 1023));
}
function common(options: Record<string, unknown>) {
  if (typeof options.relyingPartyId !== "string" || !RELYING_PARTY.test(options.relyingPartyId)) throw new SparkError("E_INVALID_ARGUMENT", "relyingPartyId is a lowercase domain name such as example.com");
  if (options.userVerification !== undefined && !["required", "preferred", "discouraged"].includes(options.userVerification as string)) throw new SparkError("E_INVALID_ARGUMENT", "userVerification is required, preferred or discouraged");
  return { relyingPartyId: options.relyingPartyId, challenge: binary(options.challenge, "challenge", 16, 1024), userVerification: options.userVerification };
}
const isRegistration = (value: unknown): value is PasskeyRegistration =>
  isRecord(value) && isBase64URL(value.credentialId) && isBase64URL(value.clientDataJSON) && (value.attestationObject === null || isBase64URL(value.attestationObject));
const isAssertion = (value: unknown): value is PasskeyAssertion =>
  isRecord(value) && (["credentialId", "userId", "clientDataJSON", "authenticatorData", "signature"] as const).every(key => isBase64URL(value[key]));

/**
 * macOS only; Windows reports `unsupported-platform` (#423). `missing-entitlement` until the app is built with
 * `relyingPartyId` in `macos.authentication.passkeyDomains` and signed by its team (docs/authentication.md). It cannot
 * tell whether the domain's apple-app-site-association file lists the app; a request then rejects reason `failed`.
 */
export function getPasskeyAvailability(relyingPartyId: string): AuthorizationAvailability {
  if (typeof relyingPartyId !== "string" || !RELYING_PARTY.test(relyingPartyId)) throw new SparkError("E_INVALID_ARGUMENT", "relyingPartyId is a lowercase domain name such as example.com");
  return availability("passkeys", relyingPartyId);
}

/**
 * Asks the person to create a passkey for the relying party (Touch ID, the login password, or another device), stored in
 * their iCloud Keychain or password manager. Resolves the registration for your server to verify, or `{ type: "cancel" }`;
 * rejects an AuthorizationError, E_BUSY while another authorization request is showing and E_NOT_FOUND without a window.
 */
export async function createPasskey(options: PasskeyRegistrationOptions): Promise<PasskeyRegistrationResult> {
  const checked = checkOptions(options, ["relyingPartyId", "challenge", "userVerification", "windowId", "signal", "userId", "userName", "displayName", "attestation", "excludeCredentials"]);
  const request = { ...common(checked), userId: binary(checked.userId, "userId", 1, 64), excludeCredentials: credentials(checked.excludeCredentials, "excludeCredentials"), attestation: checked.attestation };
  if (!text(checked.userName, 256)) throw new SparkError("E_INVALID_ARGUMENT", "userName is 1–256 characters");
  if (checked.displayName !== undefined && !text(checked.displayName, 256)) throw new SparkError("E_INVALID_ARGUMENT", "displayName is 1–256 characters");
  if (checked.attestation !== undefined && !["none", "direct", "indirect", "enterprise"].includes(checked.attestation as string)) throw new SparkError("E_INVALID_ARGUMENT", "attestation is none, direct, indirect or enterprise");
  return perform("createPasskey", { ...request, userName: checked.userName, displayName: checked.displayName }, checked, isRegistration);
}

/**
 * Asks the person to sign in with a passkey for the relying party. Resolves the assertion for your server to verify, or
 * `{ type: "cancel" }`; rejects like createPasskey.
 */
export async function getPasskey(options: PasskeyAssertionOptions): Promise<PasskeyAssertionResult> {
  const checked = checkOptions(options, ["relyingPartyId", "challenge", "userVerification", "windowId", "signal", "allowCredentials"]);
  return perform("getPasskey", { ...common(checked), allowCredentials: credentials(checked.allowCredentials, "allowCredentials") }, checked, isAssertion);
}
