import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import type { AppleIDCredential, AppleIDRequest } from "./apple";
import { appleIdRequest, availability, checkOptions, failure, isAppleIDCredential, isRecord, perform, requireNative, text, type AuthorizationAvailability } from "./shared";
export { AuthorizationError, type AuthorizationAvailability, type AuthorizationErrorReason } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AppleIDCredential, AppleIDRequest } from "./apple";

/**
 * Binary values (challenge, user ID, credential IDs and the authenticator's responses) are unpadded base64url strings,
 * as in WebAuthn's JSON serialization (`PublicKeyCredential.toJSON()`), so they pass to and from a server unchanged.
 */
export type Base64URLString = string;
/** How strongly the authenticator must verify the person (WebAuthn user verification). */
export type PasskeyUserVerification = "required" | "preferred" | "discouraged";
/**
 * Which authenticator holds the credential (WebAuthn's authenticatorAttachment): `platform` is this Mac's passkeys (the
 * person's iCloud Keychain or password manager, which also reaches a phone through the sheet's QR code); `cross-platform`
 * is a physical security key over USB, NFC or Bluetooth.
 */
export type AuthenticatorAttachment = "platform" | "cross-platform";
/** How a security key is reached (WebAuthn transports AuthenticationServices supports). */
export type SecurityKeyTransport = "usb" | "nfc" | "ble";
/** A credential ID with the transports its security key reported at registration (WebAuthn's PublicKeyCredentialDescriptor). */
export interface PasskeyCredentialDescriptor {
  id: Base64URLString;
  /** Security keys only (authenticatorAttachment `cross-platform` or `any`). Default: every transport. */
  transports?: SecurityKeyTransport[];
}
/**
 * Passkey features that depend on the macOS version, for `getPasskeyAvailability(relyingPartyId, feature)`: `securityKeys`
 * and `largeBlob` (macOS 14, Spark's minimum), `prf` (macOS 15), `securityKeyPrf` (prf with security keys, macOS 26.4) and
 * `signals` (the signal functions, macOS 26).
 */
export type PasskeyFeature = "securityKeys" | "prf" | "securityKeyPrf" | "largeBlob" | "signals";
/** WebAuthn PRF salts (inputs) or outputs: 1–1024 bytes each. */
export interface PasskeyPRFValues { first: Base64URLString; second?: Base64URLString }
/** WebAuthn extensions for `createPasskey`, in WebAuthn's JSON shape. */
export interface PasskeyRegistrationExtensions {
  /** `{}` asks whether the passkey supports PRF; `eval` also evaluates it. macOS 15; with security keys macOS 26.4. */
  prf?: { eval?: PasskeyPRFValues };
  /** A large blob stored with the passkey. Platform passkeys only (authenticatorAttachment `platform`). */
  largeBlob?: { support: "required" | "preferred" };
}
/** WebAuthn extensions for `getPasskey`, in WebAuthn's JSON shape. */
export interface PasskeyAssertionExtensions {
  /** Salts for every credential (`eval`) or per credential ID in allowCredentials (`evalByCredential`). macOS 15; with security keys macOS 26.4. */
  prf?: { eval?: PasskeyPRFValues; evalByCredential?: Record<Base64URLString, PasskeyPRFValues> };
  /** Read the passkey's large blob, or write one (1–65536 bytes; needs allowCredentials). Platform passkeys only. */
  largeBlob?: { read: true } | { write: Base64URLString };
}
/** The registration's extension outputs: only the extensions asked for, and only those the authenticator answered. */
export interface PasskeyRegistrationExtensionResults {
  prf?: { enabled: boolean; results?: PasskeyPRFValues };
  largeBlob?: { supported: boolean };
}
/** The assertion's extension outputs: only the extensions asked for, and only those the authenticator answered. */
export interface PasskeyAssertionExtensionResults {
  prf?: { results: PasskeyPRFValues };
  /** `blob`: what was read (null when there is none or it was a write); `written`: whether a write was stored. */
  largeBlob?: { blob: Base64URLString | null; written: boolean };
}
interface PasskeyRequestOptions {
  /** The relying party's domain (example.com): the app must be entitled to webcredentials:<it>, and it must list the app. */
  relyingPartyId: string;
  /** From your server, 16–1024 bytes. */
  challenge: Base64URLString;
  /** Default `preferred`. */
  userVerification?: PasskeyUserVerification;
  /**
   * Default `platform`. `cross-platform` asks for a security key (ASAuthorizationSecurityKeyPublicKeyCredentialProvider);
   * `any` offers both in one sheet.
   */
  authenticatorAttachment?: AuthenticatorAttachment | "any";
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
  /** 1–256 characters. A security key shows `userName` without it. */
  displayName?: string;
  /** Default `none`. */
  attestation?: "none" | "direct" | "indirect" | "enterprise";
  /** Credentials the account already has; one of them on this Mac or the security key rejects E_ALREADY_EXISTS. Platform passkeys: macOS 15 and later. */
  excludeCredentials?: (Base64URLString | PasskeyCredentialDescriptor)[];
  extensions?: PasskeyRegistrationExtensions;
}
/** What a passkey sign-in asks for: in `getPasskey`, and in a combined `getCredential`. */
export interface PasskeyAssertionRequest {
  /** The relying party's domain (example.com): the app must be entitled to webcredentials:<it>, and it must list the app. */
  relyingPartyId: string;
  /** From your server, 16–1024 bytes. */
  challenge: Base64URLString;
  /** Default `preferred`. */
  userVerification?: PasskeyUserVerification;
  /** Default `platform`; `cross-platform`: a security key; `any`: both in one sheet. */
  authenticatorAttachment?: AuthenticatorAttachment | "any";
  /** Only these credentials may answer. Default: any passkey for the relying party. */
  allowCredentials?: (Base64URLString | PasskeyCredentialDescriptor)[];
  extensions?: PasskeyAssertionExtensions;
}
/** Options for `getPasskey` (macOS only). */
export interface PasskeyAssertionOptions extends PasskeyAssertionRequest {
  /**
   * Show the sheet only if a passkey for the relying party is on this Mac (`performRequestsWithOptions:`), instead of
   * offering another device's QR code. With none, AuthenticationServices shows nothing and ends the request the way it
   * ends a cancel, so it resolves `{ type: "cancel" }`. Security keys are never immediately available.
   */
  preferImmediatelyAvailableCredentials?: boolean;
  /** The window to present over (useWindowId(); "main" for the main window). Default: the key window. */
  windowId?: string;
  /** Aborting cancels the sheet and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
/** A new passkey from `createPasskey`, for your server to verify and store. */
export interface PasskeyRegistration {
  credentialId: Base64URLString;
  clientDataJSON: Base64URLString;
  /** CBOR attestation object; null when the authenticator returns none. */
  attestationObject: Base64URLString | null;
  /** `cross-platform` for a security key, or a phone reached through the sheet. */
  authenticatorAttachment: AuthenticatorAttachment;
  /** A security key's transports, for later allowCredentials (macOS 14.5 and later); null for other authenticators and before 14.5. */
  transports: SecurityKeyTransport[] | null;
  extensions: PasskeyRegistrationExtensionResults;
}
/** A passkey assertion from `getPasskey`, for your server to verify against the stored public key. */
export interface PasskeyAssertion {
  credentialId: Base64URLString;
  /** The user handle given when the passkey was created. */
  userId: Base64URLString;
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
  authenticatorAttachment: AuthenticatorAttachment;
  extensions: PasskeyAssertionExtensionResults;
}
/** Result of `createPasskey`: the registration, or `cancel` when the person cancels. */
export type PasskeyRegistrationResult = { type: "success"; credential: PasskeyRegistration } | { type: "cancel" };
/** Result of `getPasskey`: the assertion, or `cancel` when the person cancels. */
export type PasskeyAssertionResult = { type: "success"; credential: PasskeyAssertion } | { type: "cancel" };
/** Options for `getCredential`: a passkey and/or Sign in with Apple, offered in one sheet. */
export interface CredentialRequestOptions {
  passkey?: PasskeyAssertionRequest;
  appleId?: AppleIDRequest;
  /** As in `getPasskey`: show the sheet only with a passkey on this Mac or Sign in with Apple to offer. */
  preferImmediatelyAvailableCredentials?: boolean;
  /** The window to present over (useWindowId(); "main" for the main window). Default: the key window. */
  windowId?: string;
  /** Aborting cancels the sheet and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
/** Result of `getCredential`: what the person signed in with, or `cancel`. */
export type CredentialResult = { type: "passkey"; credential: PasskeyAssertion } | { type: "appleId"; credential: AppleIDCredential } | { type: "cancel" };

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const isBase64URL = (value: unknown): value is string => typeof value === "string" && BASE64URL.test(value) && value.length % 4 !== 1;
/** Decoded length of unpadded base64url. */
const bytes = (value: string) => Math.floor(value.length * 3 / 4);
const RELYING_PARTY = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ATTACHMENTS = ["platform", "cross-platform"];
const TRANSPORTS = ["usb", "nfc", "ble"];
const FEATURES: readonly PasskeyFeature[] = ["securityKeys", "prf", "securityKeyPrf", "largeBlob", "signals"];

function binary(value: unknown, name: string, minimum: number, maximum: number): string {
  if (!isBase64URL(value) || bytes(value) < minimum || bytes(value) > maximum) throw new SparkError("E_INVALID_ARGUMENT", `${name} is ${minimum}–${maximum} bytes as unpadded base64url`);
  return value;
}
function relyingParty(value: unknown): string {
  if (typeof value !== "string" || !RELYING_PARTY.test(value)) throw new SparkError("E_INVALID_ARGUMENT", "relyingPartyId is a lowercase domain name such as example.com");
  return value;
}
/** Rejects keys outside `allowed` in a nested options object: E_UNSUPPORTED_OPTION, never dropped. */
function keys(value: unknown, name: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new SparkError("E_INVALID_ARGUMENT", `${name} is an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${name} option: ${key}`);
  return value;
}
function credentials(value: unknown, name: string, securityKeys: boolean) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 64) throw new SparkError("E_INVALID_ARGUMENT", `${name} lists at most 64 credential IDs`);
  return value.map(item => {
    if (typeof item === "string") return binary(item, `Each of ${name}`, 1, 1023);
    const descriptor = keys(item, name, ["id", "transports"]);
    binary(descriptor.id, `Each of ${name}`, 1, 1023);
    const { transports } = descriptor;
    if (transports === undefined) return descriptor;
    if (!securityKeys) throw new SparkError("E_INVALID_ARGUMENT", `${name} transports are for security keys (authenticatorAttachment cross-platform or any)`);
    if (!Array.isArray(transports) || !transports.length || new Set(transports).size !== transports.length || !transports.every(transport => TRANSPORTS.includes(transport)))
      throw new SparkError("E_INVALID_ARGUMENT", `${name} transports list usb, nfc and ble at most once each`);
    return descriptor;
  });
}
function salts(value: unknown, name: string) {
  const checked = keys(value, name, ["first", "second"]);
  binary(checked.first, `${name}.first`, 1, 1024);
  if (checked.second !== undefined) binary(checked.second, `${name}.second`, 1, 1024);
}
/** WebAuthn's prf and largeBlob; largeBlob is for platform passkeys only, as AuthenticationServices has none for security keys. */
function extensions(value: unknown, registration: boolean, attachment: unknown, allowed: unknown[] | undefined) {
  if (value === undefined) return undefined;
  const checked = keys(value, "extensions", ["prf", "largeBlob"]);
  if (checked.prf !== undefined) {
    const prf = keys(checked.prf, "prf", registration ? ["eval"] : ["eval", "evalByCredential"]);
    if (prf.eval !== undefined) salts(prf.eval, "prf.eval");
    if (!registration && prf.eval === undefined && prf.evalByCredential === undefined) throw new SparkError("E_INVALID_ARGUMENT", "prf has eval and/or evalByCredential");
    if (prf.evalByCredential !== undefined) {
      if (!isRecord(prf.evalByCredential) || !Object.keys(prf.evalByCredential).length) throw new SparkError("E_INVALID_ARGUMENT", "prf.evalByCredential maps credential IDs to salts");
      const ids = (allowed ?? []).map(item => typeof item === "string" ? item : (item as PasskeyCredentialDescriptor).id);
      for (const [id, values] of Object.entries(prf.evalByCredential)) {
        if (!ids.includes(id)) throw new SparkError("E_INVALID_ARGUMENT", "prf.evalByCredential names only credential IDs in allowCredentials");
        salts(values, "prf.evalByCredential");
      }
    }
  }
  if (checked.largeBlob !== undefined) {
    const blob = keys(checked.largeBlob, "largeBlob", registration ? ["support"] : ["read", "write"]);
    if (registration ? !["required", "preferred"].includes(blob.support as string) : (blob.read === undefined) === (blob.write === undefined) || (blob.read !== undefined && blob.read !== true))
      throw new SparkError("E_INVALID_ARGUMENT", registration ? "largeBlob is { support: required or preferred }" : "largeBlob is { read: true } or { write }");
    if (blob.write !== undefined) {
      binary(blob.write, "largeBlob.write", 1, 65536);
      if (!allowed?.length) throw new SparkError("E_INVALID_ARGUMENT", "largeBlob.write needs allowCredentials");
    }
    if ((attachment ?? "platform") !== "platform") throw new SparkError("E_UNSUPPORTED_OPTION", "largeBlob is for platform passkeys (authenticatorAttachment platform)");
  }
  return checked;
}
function common(options: Record<string, unknown>) {
  if (options.userVerification !== undefined && !["required", "preferred", "discouraged"].includes(options.userVerification as string)) throw new SparkError("E_INVALID_ARGUMENT", "userVerification is required, preferred or discouraged");
  const attachment = options.authenticatorAttachment;
  if (attachment !== undefined && ![...ATTACHMENTS, "any"].includes(attachment as string)) throw new SparkError("E_INVALID_ARGUMENT", "authenticatorAttachment is platform, cross-platform or any");
  return { relyingPartyId: relyingParty(options.relyingPartyId), challenge: binary(options.challenge, "challenge", 16, 1024), userVerification: options.userVerification, authenticatorAttachment: attachment };
}
const usesSecurityKeys = (options: Record<string, unknown>) => options.authenticatorAttachment === "cross-platform" || options.authenticatorAttachment === "any";
function assertionRequest(options: Record<string, unknown>) {
  const allowCredentials = credentials(options.allowCredentials, "allowCredentials", usesSecurityKeys(options));
  return { ...common(options), allowCredentials, extensions: extensions(options.extensions, false, options.authenticatorAttachment, allowCredentials) };
}
function immediate(value: unknown) {
  if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "preferImmediatelyAvailableCredentials is a boolean");
  return value;
}
const ASSERTION_KEYS = ["relyingPartyId", "challenge", "userVerification", "authenticatorAttachment", "allowCredentials", "extensions"] as const;

const isPRF = (value: unknown) => isRecord(value) && isBase64URL(value.first) && (value.second === undefined || isBase64URL(value.second));
const isRegistrationExtensions = (value: unknown) => isRecord(value)
  && (value.prf === undefined || (isRecord(value.prf) && typeof value.prf.enabled === "boolean" && (value.prf.results === undefined || isPRF(value.prf.results))))
  && (value.largeBlob === undefined || (isRecord(value.largeBlob) && typeof value.largeBlob.supported === "boolean"));
const isAssertionExtensions = (value: unknown) => isRecord(value)
  && (value.prf === undefined || (isRecord(value.prf) && isPRF(value.prf.results)))
  && (value.largeBlob === undefined || (isRecord(value.largeBlob) && (value.largeBlob.blob === null || isBase64URL(value.largeBlob.blob)) && typeof value.largeBlob.written === "boolean"));
const isRegistration = (value: unknown): value is PasskeyRegistration =>
  isRecord(value) && isBase64URL(value.credentialId) && isBase64URL(value.clientDataJSON) && (value.attestationObject === null || isBase64URL(value.attestationObject))
  && ATTACHMENTS.includes(value.authenticatorAttachment as string) && isRegistrationExtensions(value.extensions)
  && (value.transports === null || (Array.isArray(value.transports) && value.transports.every(transport => TRANSPORTS.includes(transport))));
const isAssertion = (value: unknown): value is PasskeyAssertion =>
  isRecord(value) && (["credentialId", "userId", "clientDataJSON", "authenticatorData", "signature"] as const).every(key => isBase64URL(value[key]))
  && ATTACHMENTS.includes(value.authenticatorAttachment as string) && isAssertionExtensions(value.extensions);

/**
 * macOS only; Windows reports `unsupported-platform` (#423). `missing-entitlement` until the app is built with
 * `relyingPartyId` in `macos.authentication.passkeyDomains` and signed by its team (docs/authentication.md). It cannot
 * tell whether the domain's apple-app-site-association file lists the app; a request then rejects reason `failed`.
 * With a `feature`, `host-restriction` when this macOS lacks it (checked before the entitlement); throws
 * E_INVALID_ARGUMENT for an unknown feature.
 */
export function getPasskeyAvailability(relyingPartyId: string, feature?: PasskeyFeature): AuthorizationAvailability {
  relyingParty(relyingPartyId);
  if (feature !== undefined && !FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", `feature is one of ${FEATURES.join(", ")}`);
  return availability("passkeys", relyingPartyId, feature);
}

/**
 * Asks the person to create a passkey for the relying party (Touch ID, the login password, another device, or a
 * security key with `authenticatorAttachment`), stored in their iCloud Keychain, password manager or the key. Resolves the
 * registration for your server to verify, or `{ type: "cancel" }`; rejects an AuthorizationError, E_BUSY while another
 * authorization request is showing, E_NOT_FOUND without a window, and E_UNSUPPORTED_OPTION for an extension this macOS
 * lacks (`getPasskeyAvailability(relyingPartyId, "prf")`).
 */
export async function createPasskey(options: PasskeyRegistrationOptions): Promise<PasskeyRegistrationResult> {
  const checked = checkOptions(options, ["relyingPartyId", "challenge", "userVerification", "authenticatorAttachment", "windowId", "signal", "userId", "userName", "displayName", "attestation", "excludeCredentials", "extensions"]);
  const request = { ...common(checked), userId: binary(checked.userId, "userId", 1, 64), excludeCredentials: credentials(checked.excludeCredentials, "excludeCredentials", usesSecurityKeys(checked)), attestation: checked.attestation };
  if (!text(checked.userName, 256)) throw new SparkError("E_INVALID_ARGUMENT", "userName is 1–256 characters");
  if (checked.displayName !== undefined && !text(checked.displayName, 256)) throw new SparkError("E_INVALID_ARGUMENT", "displayName is 1–256 characters");
  if (checked.attestation !== undefined && !["none", "direct", "indirect", "enterprise"].includes(checked.attestation as string)) throw new SparkError("E_INVALID_ARGUMENT", "attestation is none, direct, indirect or enterprise");
  const registration = { ...request, userName: checked.userName, displayName: checked.displayName, extensions: extensions(checked.extensions, true, checked.authenticatorAttachment, undefined) };
  return perform("createPasskey", registration, checked, isRegistration);
}

/**
 * Asks the person to sign in with a passkey (or a security key, with `authenticatorAttachment`) for the relying party.
 * Resolves the assertion for your server to verify, or `{ type: "cancel" }`; rejects like createPasskey.
 */
export async function getPasskey(options: PasskeyAssertionOptions): Promise<PasskeyAssertionResult> {
  const checked = checkOptions(options, [...ASSERTION_KEYS, "preferImmediatelyAvailableCredentials", "windowId", "signal"]);
  return perform("getPasskey", { ...assertionRequest(checked), preferImmediatelyAvailableCredentials: immediate(checked.preferImmediatelyAvailableCredentials) }, checked, isAssertion);
}

/**
 * One sheet offering a passkey (and security keys, with the passkey's `authenticatorAttachment`) and Sign in with Apple:
 * one ASAuthorizationController with every request. Give `passkey`, `appleId` or both. Resolves what the person used,
 * or `{ type: "cancel" }`; rejects like createPasskey, and missingEntitlement when either entitlement is missing.
 */
export async function getCredential(options: CredentialRequestOptions): Promise<CredentialResult> {
  const checked = checkOptions(options, ["passkey", "appleId", "preferImmediatelyAvailableCredentials", "windowId", "signal"]);
  if (checked.passkey === undefined && checked.appleId === undefined) throw new SparkError("E_INVALID_ARGUMENT", "getCredential takes passkey and/or appleId options");
  const request = {
    passkey: checked.passkey === undefined ? undefined : assertionRequest(keys(checked.passkey, "passkey", ASSERTION_KEYS)),
    appleId: checked.appleId === undefined ? undefined : appleIdRequest(keys(checked.appleId, "appleId", ["scopes", "state", "nonce"])),
    preferImmediatelyAvailableCredentials: immediate(checked.preferImmediatelyAvailableCredentials),
  };
  const result = await perform("getCredential", request, checked, (value): value is PasskeyAssertion | AppleIDCredential =>
    (request.passkey !== undefined && isAssertion(value)) || (request.appleId !== undefined && isAppleIDCredential(value)));
  if (result.type === "cancel") return result;
  return isAssertion(result.credential) ? { type: "passkey", credential: result.credential } : { type: "appleId", credential: result.credential as AppleIDCredential };
}

async function signal(kind: string, options: Record<string, unknown>): Promise<void> {
  const native = requireNative();
  const value = parseNativeResult(await invokeNative(() => native.call("signal", JSON.stringify({ ...options, kind }))), (result): result is null | { type: "failure"; reason: string; message: string } =>
    result === null || (isRecord(result) && result.type === "failure" && typeof result.reason === "string" && typeof result.message === "string"));
  if (value !== null) failure(value.reason, value.message);
}
/**
 * Tells the person's credential manager the relying party no longer knows this credential (WebAuthn's
 * signalUnknownCredential; ASCredentialUpdater), for example after a sign-in your server rejected, so it can remove the
 * passkey. Shows nothing. macOS 26 (`getPasskeyAvailability(relyingPartyId, "signals")`): E_UNAVAILABLE before; rejects
 * missingEntitlement like the requests.
 */
export async function signalUnknownCredential(options: { relyingPartyId: string; credentialId: Base64URLString }): Promise<void> {
  const checked = checkOptions(options, ["relyingPartyId", "credentialId"]);
  return signal("unknownCredential", { relyingPartyId: relyingParty(checked.relyingPartyId), credentialId: binary(checked.credentialId, "credentialId", 1, 1023) });
}
/**
 * Tells the person's credential manager every credential the relying party still accepts for the user (WebAuthn's
 * signalAllAcceptedCredentials), so it can remove the user's others. Rejects like signalUnknownCredential.
 */
export async function signalAllAcceptedCredentials(options: { relyingPartyId: string; userId: Base64URLString; allAcceptedCredentialIds: Base64URLString[] }): Promise<void> {
  const checked = checkOptions(options, ["relyingPartyId", "userId", "allAcceptedCredentialIds"]);
  const ids = checked.allAcceptedCredentialIds;
  if (!Array.isArray(ids) || ids.length > 1024) throw new SparkError("E_INVALID_ARGUMENT", "allAcceptedCredentialIds lists at most 1024 credential IDs");
  return signal("allAcceptedCredentials", { relyingPartyId: relyingParty(checked.relyingPartyId), userId: binary(checked.userId, "userId", 1, 64),
    allAcceptedCredentialIds: ids.map(id => binary(id, "Each of allAcceptedCredentialIds", 1, 1023)) });
}
/**
 * Tells the person's credential manager the user's current account name (WebAuthn's signalCurrentUserDetails; Apple
 * takes the name only, so there is no displayName), so the user's passkeys show it. Rejects like signalUnknownCredential.
 */
export async function signalCurrentUserDetails(options: { relyingPartyId: string; userId: Base64URLString; name: string }): Promise<void> {
  const checked = checkOptions(options, ["relyingPartyId", "userId", "name"]);
  if (!text(checked.name, 256)) throw new SparkError("E_INVALID_ARGUMENT", "name is 1–256 characters");
  return signal("currentUserDetails", { relyingPartyId: relyingParty(checked.relyingPartyId), userId: binary(checked.userId, "userId", 1, 64), name: checked.name });
}
