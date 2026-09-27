import * as Browser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { AppState, Linking, Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { authorize, callbackMatches, timeout, validateRedirect, validateCount, validateDigest, type CompleteAuthSessionResult, type AuthSession, type AuthSessionOptions, type AuthSessionResult } from "./types";
export type * from "./types";
export async function getRandomBytesAsync(count: number): Promise<Uint8Array> {
  validateCount(count);
  const bytes = await invokeNative(() => Crypto.getRandomBytesAsync(count));
  if (!(bytes instanceof Uint8Array) || bytes.length !== count) throw new SparkError("E_INVALID_DATA", "Random bytes do not match the requested count");
  return bytes;
}
export async function digestStringAsync(algorithm: "SHA-256", value: string): Promise<string> {
  validateDigest(algorithm, value);
  const digest = await invokeNative(() => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new SparkError("E_INVALID_DATA", "Invalid SHA-256 response");
  return digest;
}
let busy = false;
/** Call on the web redirect page. Native hosts return Expo's unsupported result. */
export function maybeCompleteAuthSession(): CompleteAuthSessionResult {
  try {
    const result = Browser.maybeCompleteAuthSession();
    if (!result || (result.type !== "success" && result.type !== "failed") || typeof result.message !== "string") throw new SparkError("E_INVALID_DATA", "Invalid popup completion response");
    return { type: result.type, message: result.message };
  } catch (error) { throw nativeError(error); }
}
export async function createAuthSession(options: AuthSessionOptions = {}): Promise<AuthSession> {
  const duration = timeout(options);
  options = { ...options };
  if (!options.redirectUri) throw new SparkError("E_INVALID_ARGUMENT", "Mobile/web authentication requires an explicit registered redirectUri");
  const redirectUri = options.redirectUri; validateRedirect(redirectUri);
  if (busy) throw new SparkError("E_BUSY", "An authentication session is already active");
  if (options.signal?.aborted) throw new SparkError("E_ABORTED", "Authentication was cancelled");
  busy = true;
  const started = Date.now();
  let state: string;
  try { state = Array.from(await getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, "0")).join(""); }
  catch (error) { busy = false; throw error; }
  let closed = false, opened = false, browserFinished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let linking: Subscription | undefined, appState: Subscription | undefined;
  type Outcome = { value: AuthSessionResult; error?: unknown };
  let resolve!: (value: Outcome) => void;
  const result = new Promise<Outcome>(done => { resolve = done; });
  const readResult = async () => { const outcome = await result; if (outcome.error) throw outcome.error; return outcome.value; };
  const cleanup = asyncRegistration(() => {
    closed = true; clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
  }, async () => {
    try {
      linking?.remove(); linking = undefined; appState?.remove(); appState = undefined;
      // Android cannot close a Custom Tab. Spark owns and removes its callback observers.
      if (opened && !browserFinished && Platform.OS !== "android") Browser.dismissAuthSession();
      busy = false;
    } catch (error) { throw nativeError(error); }
  });
  const finish = async (value: AuthSessionResult, error?: unknown) => {
    if (closed) return;
    try { await cleanup.remove(); } catch (cause) { error ??= cause; }
    resolve({ value, error: error === undefined ? undefined : nativeError(error) });
  };
  const cancel = () => { void finish({ type: "cancel" }); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const remaining = duration - (Date.now() - started);
  if (options.signal?.aborted) cancel();
  else if (remaining <= 0) void finish({ type: "timeout" });
  else timer = setTimeout(() => { void finish({ type: "timeout" }); }, remaining);
  return {
    state, redirectUri,
    async open(url) {
      if (opened) throw new SparkError("E_CLOSED", "Auth sessions can only be opened once");
      if (closed) return readResult();
      try {
        authorize(url, state, redirectUri); opened = true;
        if (Platform.OS === "android") {
          // Expo's Android auth polyfill cannot cancel its pending redirect observer.
          // Own these observers so cancellation never prevents the next session.
          linking = Linking.addEventListener("url", event => {
            if (callbackMatches(event.url, redirectUri, state)) void finish({ type: "success", url: event.url });
          });
          let departed = AppState.currentState !== null && AppState.currentState !== "active";
          appState = AppState.addEventListener("change", value => {
            if (value !== "active") departed = true;
            else if (departed) void finish({ type: "dismiss" });
          });
          void Browser.openBrowserAsync(url).then(value => {
            if (value.type === "cancel" || value.type === "dismiss") return finish({ type: value.type });
            if (value.type !== "opened") return finish({ type: "dismiss" }, new SparkError("E_INVALID_DATA", "Invalid browser launch response"));
          }).catch(error => finish({ type: "dismiss" }, error));
        } else {
          // Keep this call synchronous within the user's gesture on web.
          void Browser.openAuthSessionAsync(url, redirectUri).then(value => {
            browserFinished = true;
            if (closed) return;
            if (value.type === "success") {
              if (!callbackMatches(value.url, redirectUri, state)) return finish({ type: "dismiss" }, new SparkError("E_INVALID_DATA", "Authentication callback state or redirect did not match"));
              return finish({ type: "success", url: value.url });
            }
            if (value.type === "cancel" || value.type === "dismiss") return finish({ type: value.type });
            return finish({ type: "dismiss" }, new SparkError("E_INVALID_DATA", "Invalid authentication browser response"));
          }).catch(error => { browserFinished = true; return finish({ type: "dismiss" }, error); });
        }
      } catch (error) { await finish({ type: "dismiss" }, error); }
      return readResult();
    },
    async dismiss() { if (!closed) { await finish({ type: "dismiss" }); await readResult(); } else await cleanup.remove(); },
  };
}
