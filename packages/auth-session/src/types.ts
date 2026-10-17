import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/**
 * How an auth session ended: `success` with the callback URL, `cancel`, `dismiss`, or `timeout`. Aborting `signal`
 * gives `cancel`; `dismiss()` or a closed browser gives `dismiss`.
 */
export type AuthSessionResult = { type: "success"; url: string } | { type: "cancel" | "dismiss" | "timeout" };
/**
 * Options for `createAuthSession`. `timeoutMs` is 1 to 600000 milliseconds (default 120000); aborting `signal` ends
 * the session with `cancel`. iOS, Android and web require `redirectUri`.
 */
export type AuthSessionOptions = { redirectUri?: string; timeoutMs?: number; signal?: AbortSignal };
/**
 * A prepared sign-in from `createAuthSession`. `open()` can be called once and resolves with the `AuthSessionResult`;
 * `dismiss()` ends the session early.
 */
export interface AuthSession {
  readonly redirectUri: string;
  readonly state: string;
  open(authorizationUrl: string): Promise<AuthSessionResult>;
  dismiss(): Promise<void>;
}
/**
 * Validates `AuthSessionOptions` and returns the timeout in milliseconds (default 120000). Throws E_INVALID_ARGUMENT or
 * E_UNSUPPORTED_OPTION.
 */
export function timeout(options: AuthSessionOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected authentication options");
  for (const key of Object.keys(options)) if (!["redirectUri", "timeoutMs", "signal"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown authentication option: ${key}`);
  if (options.redirectUri !== undefined && (typeof options.redirectUri !== "string" || !options.redirectUri)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a redirect URI");
  if (options.signal !== undefined && (!options.signal || typeof options.signal.aborted !== "boolean" || typeof options.signal.addEventListener !== "function" || typeof options.signal.removeEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  const value = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(value) || value < 1 || value > 600_000) throw new SparkError("E_INVALID_ARGUMENT", "Auth timeout must be 1–600000 milliseconds");
  return value;
}
/**
 * Whether `value` has the scheme, host, port and path of `redirectUri`, no credentials, and exactly one `state`
 * parameter (query or fragment) equal to `state`.
 */
export function callbackMatches(value: string, redirectUri: string, state: string) {
  try {
    const url = new URL(value), expected = new URL(redirectUri);
    if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.port !== expected.port || url.pathname !== expected.pathname || url.username || url.password) return false;
    const states = [...url.searchParams.getAll("state"), ...new URLSearchParams(url.hash.slice(1)).getAll("state")];
    return states.length === 1 && states[0] === state;
  } catch { return false; }
}
/**
 * Checks an authorization URL before it opens: HTTPS (or http on 127.0.0.1), exactly one `state` equal to the session's,
 * and any `redirect_uri` equal to `redirectUri`. Throws E_INVALID_ARGUMENT.
 */
export function authorize(value: string, state: string, redirectUri: string) {
  const url = parseURL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) || url.username || url.password) throw new SparkError("E_INVALID_ARGUMENT", "Authorization requires HTTPS (or a local loopback test server)");
  const states = url.searchParams.getAll("state");
  if (states.length !== 1 || states[0] !== state) throw new SparkError("E_INVALID_ARGUMENT", "Authorization URL must use this session's state");
  const redirects = url.searchParams.getAll("redirect_uri");
  if (redirects.length > 1 || (redirects.length === 1 && redirects[0] !== redirectUri)) throw new SparkError("E_INVALID_ARGUMENT", "Authorization redirect_uri must match the prepared session");
}
/**
 * Parses a redirect URI; throws E_INVALID_ARGUMENT for credentials, a query or fragment, or a javascript:, data:, file:
 * or about: scheme.
 */
export function validateRedirect(uri: string) {
  const url = parseURL(uri);
  if (url.username || url.password || url.search || url.hash || ["javascript:", "data:", "file:", "about:"].includes(url.protocol)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid authentication redirect URI");
  return url;
}
/** Throws E_INVALID_ARGUMENT unless `count` is an integer from 1 to 1024. */
export function validateCount(count: number) { if (!Number.isInteger(count) || count < 1 || count > 1024) throw new SparkError("E_INVALID_ARGUMENT", "Random byte count must be 1–1024"); }
/** Throws E_INVALID_ARGUMENT unless `algorithm` is SHA-256 and `value` is a string of at most 262144 characters. */
export function validateDigest(algorithm: string, value: string) {
  if (algorithm !== "SHA-256" || typeof value !== "string" || value.length > 262144) throw new SparkError("E_INVALID_ARGUMENT", "Expected SHA-256 and at most 262144 characters");
}

function parseURL(value: string): URL {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute URL");
  try { return new URL(value); } catch (cause) { throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute URL", { cause }); }
}
/** Result of `maybeCompleteAuthSession`, in Expo's shape. */
export type CompleteAuthSessionResult = { type: "success" | "failed"; message: string };
