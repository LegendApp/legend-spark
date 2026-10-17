import { Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability, type SparkErrorCode } from "@legendapp/spark-desktop-app/src/contracts";
import Native, { type Spec } from "./NativeDesktopPrivilegedHelper";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

/**
 * Availability of privileged helpers. `sandboxed`: the app runs in the App Sandbox (the Mac App Store variant,
 * docs/app-sandbox.md), which cannot install a launch daemon or gain admin rights. `unsigned`: this build is unsigned or
 * ad-hoc signed, so it has no team for the helper to check it against and SMAppService cannot register a daemon for it
 * (docs/privileged-helper.md#signing).
 */
export type PrivilegedHelperAvailability = Availability | { available: false; reason: "sandboxed" | "unsigned" };
/**
 * A helper's launchd registration. `notFound`: the app embeds no plist for it (it is not in `macos.privilegedHelpers`).
 * `requiresApproval`: registered, waiting for the person to allow it in System Settings > General > Login Items.
 */
export type PrivilegedHelperStatus = "notRegistered" | "enabled" | "requiresApproval" | "notFound";
/**
 * Why a privileged helper operation failed. `sandboxed` (registering, the admin prompt and messaging in the App
 * Sandbox), `unsigned`, `notRegistered`, `invalidSignature` (SMAppService rejected the helper's signature, or the
 * helper is not signed by the app's team), `serviceUnavailable` and `notInteractive` (the admin prompt cannot be
 * shown): E_UNAVAILABLE. `notFound`: E_NOT_FOUND. `requiresApproval`, `denied` (the prompt was not answered by an
 * administrator) and `authorizationExpired` (the admin rights lapsed: prompt again): E_PERMISSION_DENIED.
 * `invalidPlist`: E_INVALID_DATA. `connectionInvalid` (the helper is not running or refused the connection, as it does
 * for a client that is not this app) and `connectionInterrupted` (it exited, or refused the app, with the request in
 * flight): E_CLOSED. `helperFailed`: the helper's handler replied with an error, with the code it chose. `unknown`:
 * E_NATIVE.
 */
export type PrivilegedHelperErrorReason =
  | "sandboxed" | "unsigned" | "notFound" | "notRegistered" | "requiresApproval" | "invalidSignature" | "invalidPlist" | "serviceUnavailable"
  | "denied" | "notInteractive" | "authorizationExpired" | "connectionInvalid" | "connectionInterrupted" | "helperFailed" | "unknown";
/** A privileged helper operation that ServiceManagement, Authorization Services, XPC or the helper failed. */
export class PrivilegedHelperError extends SparkError {
  readonly reason: PrivilegedHelperErrorReason;
  constructor(code: SparkErrorCode, message: string, reason: PrivilegedHelperErrorReason, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "PrivilegedHelperError";
    this.reason = reason;
  }
}
/** A JSON value: what a helper receives and replies. */
export type PrivilegedHelperMessage = null | boolean | number | string | PrivilegedHelperMessage[] | { [key: string]: PrivilegedHelperMessage };
/**
 * Administrator rights the person granted at the system admin prompt (system.privilege.admin). Pass it with a message
 * so the helper can check them itself; `close()` destroys them. A reload of the app's JavaScript closes it too.
 */
export interface AdminAuthorization {
  readonly closed: boolean;
  /**
   * When the rights lapse (Unix ms): system.privilege.admin's timeout in the authorization database, 300 seconds on
   * current macOS. Messages sent with them afterwards reject `authorizationExpired`; ask again. null: the right sets none.
   */
  readonly expiresAt: number | null;
  close(): Promise<void>;
}
export type AdminAuthorizationResult = { type: "authorized"; authorization: AdminAuthorization } | { type: "cancel" };
export interface AdminAuthorizationOptions {
  /** Why the app asks, shown in the prompt under the system's own text. 1–500 characters. */
  prompt: string;
}
export interface PrivilegedHelperMessageOptions {
  /** Send the admin rights with the message; the helper checks them and tells its handler whether they hold. */
  authorization?: AdminAuthorization;
  /** How long to wait for the reply, 1–600000 ms. Default 30000. Rejects E_TIMEOUT; the helper may still act. */
  timeoutMs?: number;
  /** Aborting rejects E_ABORTED at once; the helper may already have acted on the message. */
  signal?: AbortSignal;
}

const REASON_CODES: Record<Exclude<PrivilegedHelperErrorReason, "helperFailed">, SparkErrorCode> = {
  sandboxed: "E_UNAVAILABLE", unsigned: "E_UNAVAILABLE", notFound: "E_NOT_FOUND", notRegistered: "E_UNAVAILABLE", requiresApproval: "E_PERMISSION_DENIED",
  invalidSignature: "E_UNAVAILABLE", invalidPlist: "E_INVALID_DATA", serviceUnavailable: "E_UNAVAILABLE", denied: "E_PERMISSION_DENIED",
  notInteractive: "E_UNAVAILABLE", authorizationExpired: "E_PERMISSION_DENIED", connectionInvalid: "E_CLOSED", connectionInterrupted: "E_CLOSED", unknown: "E_NATIVE",
};
const HELPER_CODES: readonly SparkErrorCode[] = ["E_INVALID_ARGUMENT", "E_INVALID_DATA", "E_UNAVAILABLE", "E_UNSUPPORTED_OPTION", "E_PERMISSION_DENIED",
  "E_NOT_FOUND", "E_ALREADY_EXISTS", "E_BUSY", "E_CLOSED", "E_ABORTED", "E_TIMEOUT", "E_NATIVE"];
const STATUSES: readonly PrivilegedHelperStatus[] = ["notRegistered", "enabled", "requiresApproval", "notFound"];
const MAX_MESSAGE_BYTES = 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
type Failure = { type: "failure"; reason: string; code: string; message: string };
const isFailure = (value: unknown): value is Failure =>
  isRecord(value) && value.type === "failure" && typeof value.reason === "string" && typeof value.code === "string" && typeof value.message === "string";
/** A failure native reported as a result: a known reason rejects a PrivilegedHelperError; anything else is E_INVALID_DATA. */
function fail(failure: Failure): never {
  const { reason, code, message } = failure;
  if (reason === "helperFailed" && HELPER_CODES.includes(code as SparkErrorCode)) throw new PrivilegedHelperError(code as SparkErrorCode, message, "helperFailed");
  if (Object.hasOwn(REASON_CODES, reason) && REASON_CODES[reason as keyof typeof REASON_CODES] === code) throw new PrivilegedHelperError(code as SparkErrorCode, message, reason as PrivilegedHelperErrorReason);
  throw new SparkError("E_INVALID_DATA", `Unknown privileged helper failure: ${reason} (${code})`);
}

/** macOS only; Windows reports `unsupported-platform` (#440). */
export function getPrivilegedHelperAvailability(): PrivilegedHelperAvailability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  const answer = Native.availability();
  if (answer === "available") return { available: true };
  if (answer === "sandboxed" || answer === "unsigned") return { available: false, reason: answer };
  throw new SparkError("E_INVALID_DATA", `Unknown privileged helper availability: ${answer}`);
}
function requireNative(): Spec {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Privileged helpers require macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Privileged helpers require NativeDesktopPrivilegedHelper");
  return Native;
}
/** Calls native; a named failure rejects a PrivilegedHelperError, and any other result must pass `validate`. */
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  const native = requireNative();
  const value = parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), (result): result is T | Failure => isFailure(result) || validate(result));
  if (isFailure(value)) fail(value);
  return value as T;
}
const isNull = (value: unknown): value is null => value === null;
const isStatus = (value: unknown): value is PrivilegedHelperStatus => STATUSES.includes(value as PrivilegedHelperStatus);

/** A helper name as `helpers` and `macos.privilegedHelpers` declare it. */
function helperName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new SparkError("E_INVALID_ARGUMENT", "A helper name has 1–64 letters, digits, - and _");
}

/** The helper's launchd registration. Never prompts and never registers anything. */
export async function getPrivilegedHelperStatus(name: string): Promise<PrivilegedHelperStatus> {
  helperName(name);
  return call("status", { name }, isStatus);
}

/**
 * Registers the helper's launch daemon with launchd (SMAppService) and resolves its status afterwards: `enabled`, or
 * `requiresApproval` until the person allows it in Login Items (`openPrivilegedHelperSettings()`). Registering again
 * changes nothing. Rejects a PrivilegedHelperError: unsigned before anything is registered, notFound when the app embeds
 * no plist for it, invalidSignature, invalidPlist or serviceUnavailable as ServiceManagement answers.
 */
export async function registerPrivilegedHelper(name: string): Promise<PrivilegedHelperStatus> {
  helperName(name);
  return call("register", { name }, isStatus);
}

/** Removes the helper's registration, stopping it. Resolves when it is not registered, including when it was not. */
export async function unregisterPrivilegedHelper(name: string): Promise<void> {
  helperName(name);
  await call("unregister", { name }, isNull);
}

/** Opens System Settings > General > Login Items, where the person allows a helper that requires approval. */
export async function openPrivilegedHelperSettings(): Promise<void> {
  await call("openSettings", {}, isNull);
}

/**
 * Shows the system admin prompt, asking for an administrator's name and password with `prompt` as the reason. Resolves
 * the granted AdminAuthorization, or `{ type: "cancel" }` when the person cancels; rejects a PrivilegedHelperError
 * (`denied`, `notInteractive`, `sandboxed`) and E_BUSY while another prompt is up. The prompt is the system's: it
 * cannot be cancelled by the app. Nothing runs with these rights in the app: send them to the helper, which checks
 * them. Call it from a person's action.
 */
export async function requestAdminAuthorization(options: AdminAuthorizationOptions): Promise<AdminAuthorizationResult> {
  if (!isRecord(options as unknown)) throw new SparkError("E_INVALID_ARGUMENT", "Expected admin authorization options");
  for (const key of Object.keys(options)) if (key !== "prompt") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported admin authorization option: ${key}`);
  const { prompt } = options;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500 || prompt.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "prompt is 1–500 characters");
  const result = await call("authorize", { prompt }, (value): value is { type: "authorized"; id: string; expiresAt: number | null } | { type: "cancel" } =>
    isRecord(value) && ((value.type === "authorized" && typeof value.id === "string" && value.id.length > 0 && (value.expiresAt === null || Number.isFinite(value.expiresAt))) || value.type === "cancel"));
  return result.type === "cancel" ? { type: "cancel" } : { type: "authorized", authorization: authorizationHandle(result.id, result.expiresAt) };
}

const handles = new WeakMap<AdminAuthorization, string>();
function authorizationHandle(id: string, expiresAt: number | null): AdminAuthorization {
  let closed = false, closing: Promise<void> | undefined;
  const handle: AdminAuthorization = {
    get closed() { return closed; },
    expiresAt,
    close() {
      closed = true;
      // Concurrent closes share completion; a failed close stays retryable.
      return closing ??= call("release", { id }, isNull).then(() => {}, error => { closing = undefined; throw error; });
    },
  };
  handles.set(handle, id);
  return handle;
}

/** A JSON value of at most 1 MiB once encoded: plain objects, arrays, strings, finite numbers, booleans and null. */
function checkMessage(value: unknown, depth = 0): asserts value is PrivilegedHelperMessage {
  const invalid = () => { throw new SparkError("E_INVALID_ARGUMENT", "A helper message is JSON: plain objects, arrays, strings, finite numbers, booleans and null, nested at most 64 deep"); };
  if (depth > 64) invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return; }
  if (Array.isArray(value)) { for (const item of value) checkMessage(item, depth + 1); return; }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid();
  for (const item of Object.values(value as object)) checkMessage(item, depth + 1);
}

let requests = 0;
/**
 * Sends a JSON message to the helper over XPC and resolves its JSON reply. The helper must be `enabled`; otherwise this
 * rejects a PrivilegedHelperError with its status as the reason (notRegistered, requiresApproval, notFound). Each
 * connection first checks that the helper is signed by this app's team (invalidSignature) and the helper checks this
 * app the same way (connectionInvalid or connectionInterrupted for an app it refuses). Rights past `expiresAt`, or that
 * the helper finds no longer hold, reject authorizationExpired. The helper's own errors reject
 * reason helperFailed with the code it chose.
 */
export async function sendPrivilegedHelperMessage(name: string, message: PrivilegedHelperMessage, options: PrivilegedHelperMessageOptions = {}): Promise<PrivilegedHelperMessage> {
  helperName(name);
  checkMessage(message);
  if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES) throw new SparkError("E_INVALID_ARGUMENT", "A helper message is at most 1 MiB of JSON");
  if (!isRecord(options as unknown)) throw new SparkError("E_INVALID_ARGUMENT", "Expected helper message options");
  for (const key of Object.keys(options)) if (!["authorization", "timeoutMs", "signal"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported helper message option: ${key}`);
  const { authorization, timeoutMs = 30000, signal } = options;
  const authorizationId = authorization === undefined ? undefined : handles.get(authorization);
  if (authorization !== undefined && authorizationId === undefined) throw new SparkError("E_INVALID_ARGUMENT", "authorization is an AdminAuthorization from requestAdminAuthorization");
  if (authorization?.closed) throw new SparkError("E_CLOSED", "The admin authorization is closed");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new SparkError("E_INVALID_ARGUMENT", "timeoutMs is an integer from 1 to 600000");
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  const native = requireNative();
  if (signal?.aborted) throw new SparkError("E_ABORTED", "The helper message was aborted before it was sent");
  const id = String(++requests);
  // A cancel that fails leaves the request to its reply or timeout, so the call still settles.
  const abort = () => { void invokeNative(() => native.call("cancel", JSON.stringify({ id }))).catch(console.error); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const reply = await call("send", { id, name, message, authorization: authorizationId, timeoutMs }, (value): value is { value: PrivilegedHelperMessage } => isRecord(value) && "value" in value);
    return reply.value;
  } finally { signal?.removeEventListener("abort", abort); }
}
