import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** Only default storage is portable today. Authentication/service overrides are not implemented. */
export type SecureStoreOptions = Record<string, never>;
export function validateItem(key: string, options: SecureStoreOptions) {
  if (typeof key !== "string" || !/^[\w.-]+$/.test(key) || key.length > 200) throw new SparkError("E_INVALID_ARGUMENT", "SecureStore keys must be 1–200 alphanumeric, '.', '-', or '_' characters");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).length) throw new SparkError("E_UNSUPPORTED_OPTION", "SecureStore options are not supported by the shared API");
}
