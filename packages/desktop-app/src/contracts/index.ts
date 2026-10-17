/** Contracts shared by Spark-owned APIs. This module never loads native code. */
export type SparkErrorCode =
  | "E_INVALID_ARGUMENT" | "E_INVALID_DATA" | "E_UNAVAILABLE" | "E_UNSUPPORTED_PLATFORM"
  | "E_UNSUPPORTED_OPTION" | "E_MODULE_UNAVAILABLE" | "E_PERMISSION_DENIED"
  | "E_NOT_FOUND" | "E_NOT_EMPTY" | "E_ALREADY_EXISTS" | "E_READ_ONLY" | "E_NO_SPACE" | "E_BUSY" | "E_CLOSED"
  | "E_ABORTED" | "E_TIMEOUT" | "E_NATIVE";

/** The error Spark APIs throw and reject with. Branch on `code`, not on `message`. */
export class SparkError extends Error {
  readonly code: SparkErrorCode;
  constructor(code: SparkErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SparkError";
    this.code = code;
  }
}

/** Result of the `get*Availability()` queries. `unsupported-platform`: not on this OS. `missing-module`: the native module is not installed. `host-restriction`: this host does not support the feature. */
export type Availability =
  | { available: true }
  | { available: false; reason: "unsupported-platform" | "missing-module" | "host-restriction" };
/** A listener registration; `remove()` stops its callbacks. */
export interface Subscription { remove(): void }
/** A registration that owns native state. `remove()` stops callbacks immediately and resolves when native cleanup finishes; concurrent calls join, and a failed cleanup can be retried. */
export interface AsyncRegistration { remove(): Promise<void> }

/** Stop callbacks immediately; join concurrent cleanup, and permit retry on failure. */
export function asyncRegistration(stop: () => void, cleanup: () => Promise<void>): AsyncRegistration {
  let stopped = false;
  let pending: Promise<void> | undefined;
  return { remove() {
    if (!stopped) { stopped = true; stop(); }
    return pending ??= Promise.resolve().then(cleanup).catch(error => {
      pending = undefined;
      throw error;
    });
  } };
}

export function parseNativeResult<T>(json: string, validate: (value: unknown) => value is T): T {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (cause) { throw new SparkError("E_INVALID_DATA", "Native response is not valid JSON", { cause }); }
  if (!validate(value)) throw new SparkError("E_INVALID_DATA", "Native response does not match its contract");
  return value;
}

/** Normalize errors added by Spark's native adapters, preserving the original failure. */
export function nativeError(cause: unknown): SparkError {
  if (cause instanceof SparkError) return cause;
  const original = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  const aliases: Record<string, SparkErrorCode> = { E_PERMISSION: "E_PERMISSION_DENIED", E_EXISTS: "E_ALREADY_EXISTS" };
  const known: readonly string[] = ["E_INVALID_ARGUMENT", "E_INVALID_DATA", "E_UNAVAILABLE", "E_UNSUPPORTED_PLATFORM", "E_UNSUPPORTED_OPTION", "E_MODULE_UNAVAILABLE", "E_PERMISSION_DENIED", "E_NOT_FOUND", "E_NOT_EMPTY", "E_ALREADY_EXISTS", "E_READ_ONLY", "E_NO_SPACE", "E_BUSY", "E_CLOSED", "E_ABORTED", "E_TIMEOUT", "E_NATIVE"];
  const code = aliases[original] ?? (known.includes(original) ? original as SparkErrorCode : "E_NATIVE");
  return new SparkError(code, cause instanceof Error ? cause.message : "Native operation failed", { cause });
}
export function invokeNative<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return Promise.resolve(operation()).catch(cause => { throw nativeError(cause); }); }
  catch (cause) { return Promise.reject(nativeError(cause)); }
}
