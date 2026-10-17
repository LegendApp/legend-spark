import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { getRandomBytesAsync } from "@legendapp/spark/auth-session";
import { AuthorizationError, getAppleAuthenticationAvailability, getAppleIDCredentialState, signInWithApple, type AppleSignInOptions, type AppleSignInResult } from "@legendapp/spark/apple-authentication";
import { createPasskey, getCredential, getPasskey, getPasskeyAvailability, signalUnknownCredential, type PasskeyFeature, type PasskeyRegistration } from "@legendapp/spark/passkeys";

/** The relying party the demo's passkeys belong to. The Kitchen Sink is not entitled to it, so real requests stop at missingEntitlement. */
export const RELYING_PARTY = "example.com";
/** The Kitchen Sink's main window: passkey requests present over it. */
const WINDOW_ID = "main";
/** What every Sign in with Apple request of the screen asks for. */
export const SIGN_IN_OPTIONS: AppleSignInOptions = { scopes: ["fullName", "email"], state: "kitchen-sink" };
const USER_NAME = "ada@example.com";
/** Latin-1 text (one byte per character) as unpadded base64url. */
const base64url = (binary: string) => btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/**
 * A random challenge where passkeys are available. Elsewhere (a missing entitlement, or Windows) the request rejects
 * before any challenge is used, so a fixed one is passed and the screen asks for no random bytes there.
 */
const challengeFor = async () => getPasskeyAvailability(RELYING_PARTY).available ? base64url(String.fromCharCode(...await getRandomBytesAsync(32))) : UNUSED_CHALLENGE;
const UNUSED_CHALLENGE = base64url("request rejects before use");
const USER_ID = base64url("kitchen-sink-user");
/** Signalled when the screen has created no passkey yet. */
const UNKNOWN_CREDENTIAL = base64url("no passkey yet");
/** Results show codes and reasons only, so flows can assert them in any locale. */
const describeFailure = (cause: unknown) =>
  cause instanceof AuthorizationError ? `AuthorizationError:${cause.code}:${cause.reason}` : cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
/** The passkey features that depend on the macOS version, shown with their availability. */
const FEATURES: PasskeyFeature[] = ["securityKeys", "prf", "securityKeyPrf", "largeBlob", "signals"];
const describeAvailability = (feature: PasskeyFeature) => {
  const availability = getPasskeyAvailability(RELYING_PARTY, feature);
  return `${feature} ${availability.available ? "available" : availability.reason}`;
};
const readAvailability = () => ({ apple: JSON.stringify(getAppleAuthenticationAvailability()), passkeys: JSON.stringify(getPasskeyAvailability(RELYING_PARTY)), features: FEATURES.map(describeAvailability).join(" · ") });
/** The PRF salt the demo evaluates at registration and sign-in: the same passkey and salt give the same output. */
const PRF_SALT = base64url("kitchen-sink prf salt");
const BLOB = base64url("kitchen-sink large blob");
export type Section = "apple" | "state" | "create" | "get" | "securityKey" | "extensions" | "immediate" | "combined" | "signal";
/** Apple's button draws where getAppleAuthenticationAvailability() is not unsupported-platform or missing-module (Windows: #423). */
export function appleButtonDraws() {
  const availability = getAppleAuthenticationAvailability();
  return availability.available || availability.reason === "missing-entitlement";
}

/**
 * Sign in with Apple and passkeys through @legendapp/spark/apple-authentication and /passkeys. Nothing is requested
 * until a button is pressed. In a test-driver run every request goes to the simulated state (docs/authentication.md#testing),
 * so nothing is presented and neither Apple nor a relying party is reached. A real challenge comes from a server; the demo
 * makes a random one.
 */
export function useSignInDemo() {
  const [availability, setAvailability] = useState(readAvailability);
  const [results, setResults] = useState<Partial<Record<Section, string>>>({});
  const [user, setUser] = useState<string>();
  // The latest passkey created with extensions, for the extension sign-in; the latest of any kind, for the signal.
  const [extended, setExtended] = useState<PasskeyRegistration>();
  const [latest, setLatest] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => setAvailability(readAvailability()), []);
  const show = useCallback((section: Section, result: string) => { setResults(current => ({ ...current, [section]: result })); refresh(); }, [refresh]);

  // A second request while one is up rejects E_BUSY; Cancel keeps cancelling the first.
  const request = useCallback(async (section: Section, run: (signal: AbortSignal) => Promise<string>) => {
    const controller = new AbortController();
    if (!abort.current) abort.current = controller;
    let result: string;
    try { result = await run(controller.signal); } catch (cause) { result = describeFailure(cause); }
    if (abort.current === controller) abort.current = undefined;
    show(section, result);
  }, [show]);

  const describeSignIn = useCallback((result: AppleSignInResult) => {
    if (result.type === "cancel") return "cancel";
    const { credential } = result;
    setUser(credential.user);
    const name = credential.fullName ? `${credential.fullName.givenName} ${credential.fullName.familyName}` : "null";
    return `success: user ${credential.user} · email ${credential.email} · name ${name} · state ${credential.state}`;
  }, []);

  // windowId: the window of the Apple button pressed. The plain button (Windows) passes none.
  const signIn = useCallback((windowId?: string) => request("apple", async signal =>
    describeSignIn(await signInWithApple({ ...SIGN_IN_OPTIONS, windowId, signal }))), [request, describeSignIn]);
  // The style variants run signInWithApple themselves (AppleSignInButton's onSignIn and onError).
  const onSignIn = useCallback((result: AppleSignInResult) => show("apple", describeSignIn(result)), [show, describeSignIn]);
  const onSignInError = useCallback((cause: unknown) => show("apple", describeFailure(cause)), [show]);

  const checkState = useCallback(async () => {
    if (!user) return;
    try { show("state", await getAppleIDCredentialState(user)); } catch (cause) { show("state", describeFailure(cause)); }
  }, [user, show]);

  const create = useCallback(() => request("create", async signal => {
    const result = await createPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), userId: USER_ID, userName: USER_NAME, displayName: "Ada", windowId: WINDOW_ID, signal });
    if (result.type === "cancel") return "cancel";
    setLatest(result.credential.credentialId);
    return `success: credential ${result.credential.credentialId}`;
  }), [request]);

  // A passkey on a security key (authenticatorAttachment cross-platform), then a sign-in offering this Mac's and the key's.
  const createOnSecurityKey = useCallback(() => request("securityKey", async signal => {
    const result = await createPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), userId: USER_ID, userName: USER_NAME, authenticatorAttachment: "cross-platform", windowId: WINDOW_ID, signal });
    if (result.type === "cancel") return "cancel";
    setLatest(result.credential.credentialId);
    return `success: credential ${result.credential.credentialId} · ${result.credential.authenticatorAttachment} · transports ${result.credential.transports?.join(",") ?? "null"}`;
  }), [request]);
  const assertWithSecurityKey = useCallback(() => request("securityKey", async signal => {
    const result = await getPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), authenticatorAttachment: "any", windowId: WINDOW_ID, signal });
    return result.type === "cancel" ? "cancel" : `success: credential ${result.credential.credentialId} · ${result.credential.authenticatorAttachment}`;
  }), [request]);

  // prf and largeBlob: registration evaluates the salt and asks for blob support; sign-in evaluates it again and writes a blob.
  const createWithExtensions = useCallback(() => request("extensions", async signal => {
    const result = await createPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), userId: USER_ID, userName: USER_NAME, windowId: WINDOW_ID, signal,
      extensions: { prf: { eval: { first: PRF_SALT } }, largeBlob: { support: "required" } } });
    if (result.type === "cancel") return "cancel";
    const { credential } = result;
    setExtended(credential);
    setLatest(credential.credentialId);
    return `success: credential ${credential.credentialId} · prf ${credential.extensions.prf?.enabled ?? "none"} · largeBlob ${credential.extensions.largeBlob?.supported ?? "none"}`;
  }), [request]);
  const assertWithExtensions = useCallback(() => request("extensions", async signal => {
    const allowCredentials = extended ? [extended.credentialId] : undefined;
    const result = await getPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), allowCredentials, windowId: WINDOW_ID, signal,
      extensions: { prf: { eval: { first: PRF_SALT } }, ...(allowCredentials ? { largeBlob: { write: BLOB } } : {}) } });
    if (result.type === "cancel") return "cancel";
    const { prf, largeBlob } = result.credential.extensions;
    const same = prf && prf.results.first === extended?.extensions.prf?.results?.first;
    return `success: credential ${result.credential.credentialId} · prf ${prf ? (same ? "same as at registration" : "differs") : "none"} · largeBlob written ${largeBlob?.written ?? "none"}`;
  }), [request, extended]);

  // Only if a passkey is on this Mac: otherwise nothing is shown and the request resolves cancel.
  const assertImmediately = useCallback(() => request("immediate", async signal => {
    const result = await getPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), preferImmediatelyAvailableCredentials: true, windowId: WINDOW_ID, signal });
    return result.type === "cancel" ? "cancel" : `success: credential ${result.credential.credentialId}`;
  }), [request]);

  // A passkey or Sign in with Apple in one sheet.
  const signInEither = useCallback(() => request("combined", async signal => {
    const result = await getCredential({ passkey: { relyingPartyId: RELYING_PARTY, challenge: await challengeFor() }, appleId: { scopes: SIGN_IN_OPTIONS.scopes, state: SIGN_IN_OPTIONS.state }, windowId: WINDOW_ID, signal });
    if (result.type === "cancel") return "cancel";
    if (result.type === "appleId") setUser(result.credential.user);
    return result.type === "passkey" ? `passkey: credential ${result.credential.credentialId}` : `appleId: user ${result.credential.user}`;
  }), [request]);

  // Tells the credential manager the server no longer knows the latest passkey.
  const signalUnknown = useCallback(async () => {
    try {
      await signalUnknownCredential({ relyingPartyId: RELYING_PARTY, credentialId: latest ?? UNKNOWN_CREDENTIAL });
      show("signal", `signalled unknown credential ${latest ?? UNKNOWN_CREDENTIAL}`);
    } catch (cause) { show("signal", describeFailure(cause)); }
  }, [latest, show]);

  const assert = useCallback(() => request("get", async signal => {
    const result = await getPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), windowId: WINDOW_ID, signal });
    return result.type === "cancel" ? "cancel" : `success: credential ${result.credential.credentialId} · user ${result.credential.userId === USER_ID ? USER_NAME : result.credential.userId}`;
  }), [request]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { availability, results, user, refresh, signIn, onSignIn, onSignInError, checkState, create, assert, cancel,
    createOnSecurityKey, assertWithSecurityKey, createWithExtensions, assertWithExtensions, assertImmediately, signInEither, signalUnknown };
}
