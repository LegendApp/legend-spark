/** Contracts shared by Spark-owned APIs. This module never loads native code. */
export type SparkErrorCode =
  | "E_INVALID_ARGUMENT" | "E_INVALID_DATA" | "E_UNSUPPORTED_PLATFORM"
  | "E_UNSUPPORTED_OPTION" | "E_MODULE_UNAVAILABLE" | "E_PERMISSION_DENIED"
  | "E_NOT_FOUND" | "E_ALREADY_EXISTS" | "E_BUSY" | "E_CLOSED"
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
