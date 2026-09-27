import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export type AuthSessionResult = { type: "success"; url: string } | { type: "cancel" | "dismiss" | "timeout" };
export type AuthSessionOptions = { redirectUri?: string; timeoutMs?: number; signal?: AbortSignal };
export interface AuthSession {
  readonly redirectUri: string;
  readonly state: string;
  open(authorizationUrl: string): Promise<AuthSessionResult>;
  dismiss(): Promise<void>;
}
export function timeout(options: AuthSessionOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected authentication options");
  for (const key of Object.keys(options)) if (!["redirectUri", "timeoutMs", "signal"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown authentication option: ${key}`);
  if (options.redirectUri !== undefined && (typeof options.redirectUri !== "string" || !options.redirectUri)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a redirect URI");
  if (options.signal !== undefined && (!options.signal || typeof options.signal.aborted !== "boolean" || typeof options.signal.addEventListener !== "function" || typeof options.signal.removeEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  const value = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(value) || value < 1 || value > 600_000) throw new SparkError("E_INVALID_ARGUMENT", "Auth timeout must be 1–600000 milliseconds");
  return value;
}
export function callbackMatches(value: string, redirectUri: string, state: string) {
  try {
    const url = new URL(value), expected = new URL(redirectUri);
    if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.port !== expected.port || url.pathname !== expected.pathname || url.username || url.password) return false;
    const states = [...url.searchParams.getAll("state"), ...new URLSearchParams(url.hash.slice(1)).getAll("state")];
    return states.length === 1 && states[0] === state;
  } catch { return false; }
}
export function authorize(value: string, state: string, redirectUri: string) {
  const url = parseURL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) || url.username || url.password) throw new SparkError("E_INVALID_ARGUMENT", "Authorization requires HTTPS (or a local loopback test server)");
  const states = url.searchParams.getAll("state");
  if (states.length !== 1 || states[0] !== state) throw new SparkError("E_INVALID_ARGUMENT", "Authorization URL must use this session's state");
  const redirects = url.searchParams.getAll("redirect_uri");
  if (redirects.length > 1 || (redirects.length === 1 && redirects[0] !== redirectUri)) throw new SparkError("E_INVALID_ARGUMENT", "Authorization redirect_uri must match the prepared session");
}
export function validateRedirect(uri: string) {
  const url = parseURL(uri);
  if (url.username || url.password || url.search || url.hash || ["javascript:", "data:", "file:", "about:"].includes(url.protocol)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid authentication redirect URI");
  return url;
}
export function validateCount(count: number) { if (!Number.isInteger(count) || count < 1 || count > 1024) throw new SparkError("E_INVALID_ARGUMENT", "Random byte count must be 1–1024"); }
export function validateDigest(algorithm: string, value: string) {
  if (algorithm !== "SHA-256" || typeof value !== "string" || value.length > 262144) throw new SparkError("E_INVALID_ARGUMENT", "Expected SHA-256 and at most 262144 characters");
}

function parseURL(value: string): URL {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute URL");
  try { return new URL(value); } catch (cause) { throw new SparkError("E_INVALID_ARGUMENT", "Expected an absolute URL", { cause }); }
}
export type CompleteAuthSessionResult = { type: "success" | "failed"; message: string };
