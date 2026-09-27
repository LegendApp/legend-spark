/** Contracts shared by Spark-owned APIs. This module never loads native code. */
export type SparkErrorCode =
  | "E_INVALID_ARGUMENT" | "E_INVALID_DATA" | "E_UNAVAILABLE" | "E_UNSUPPORTED_PLATFORM"
  | "E_UNSUPPORTED_OPTION" | "E_MODULE_UNAVAILABLE" | "E_PERMISSION_DENIED"
  | "E_NOT_FOUND" | "E_NOT_EMPTY" | "E_ALREADY_EXISTS" | "E_BUSY" | "E_CLOSED"
  | "E_ABORTED" | "E_TIMEOUT" | "E_NATIVE";

export class SparkError extends Error {
  readonly code: SparkErrorCode;
  constructor(code: SparkErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SparkError";
    this.code = code;
  }
}

export type Availability =
  | { available: true }
  | { available: false; reason: "unsupported-platform" | "missing-module" | "host-restriction" };
export interface Subscription { remove(): void }
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
  const known: readonly string[] = ["E_INVALID_ARGUMENT", "E_INVALID_DATA", "E_UNAVAILABLE", "E_UNSUPPORTED_PLATFORM", "E_UNSUPPORTED_OPTION", "E_MODULE_UNAVAILABLE", "E_PERMISSION_DENIED", "E_NOT_FOUND", "E_NOT_EMPTY", "E_ALREADY_EXISTS", "E_BUSY", "E_CLOSED", "E_ABORTED", "E_TIMEOUT", "E_NATIVE"];
  const code = aliases[original] ?? (known.includes(original) ? original as SparkErrorCode : "E_NATIVE");
  return new SparkError(code, cause instanceof Error ? cause.message : "Native operation failed", { cause });
}
export async function invokeNative<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (cause) { throw nativeError(cause); }
}
