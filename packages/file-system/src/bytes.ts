import { toByteArray } from "base64-js";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** Native transport only. Reject malformed data before base64-js can coerce it. */
export function decodeBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new SparkError("E_INVALID_DATA", "Invalid binary response");
  return toByteArray(value);
}
