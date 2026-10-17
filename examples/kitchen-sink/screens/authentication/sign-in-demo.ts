import { useCallback, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { getRandomBytesAsync } from "@legendapp/spark/auth-session";
import { AuthorizationError, getAppleAuthenticationAvailability, getAppleIDCredentialState, signInWithApple, type AppleSignInOptions, type AppleSignInResult } from "@legendapp/spark/apple-authentication";
import { createPasskey, getPasskey, getPasskeyAvailability } from "@legendapp/spark/passkeys";

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
/** Results show codes and reasons only, so flows can assert them in any locale. */
const describeFailure = (cause: unknown) =>
  cause instanceof AuthorizationError ? `AuthorizationError:${cause.code}:${cause.reason}` : cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
const readAvailability = () => ({ apple: JSON.stringify(getAppleAuthenticationAvailability()), passkeys: JSON.stringify(getPasskeyAvailability(RELYING_PARTY)) });
export type Section = "apple" | "state" | "create" | "get";
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
    return result.type === "cancel" ? "cancel" : `success: credential ${result.credential.credentialId}`;
  }), [request]);

  const assert = useCallback(() => request("get", async signal => {
    const result = await getPasskey({ relyingPartyId: RELYING_PARTY, challenge: await challengeFor(), windowId: WINDOW_ID, signal });
    return result.type === "cancel" ? "cancel" : `success: credential ${result.credential.credentialId} · user ${result.credential.userId === USER_ID ? USER_NAME : result.credential.userId}`;
  }), [request]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { availability, results, user, refresh, signIn, onSignIn, onSignInError, checkState, create, assert, cancel };
}
