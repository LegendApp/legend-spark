import { SparkError } from "../contracts";
export type BinaryCall = (method: string, args: string, buffer?: ArrayBuffer, offset?: number, length?: number) => Promise<unknown>;
type Module = { binaryCall?: BinaryCall; installBinary?: () => string | null | undefined };
/** Native snapshots the specified view synchronously before enqueueing I/O. */
export function callBinary(module: object, name: string, method: string, args: object, bytes?: Uint8Array): Promise<unknown> {
  const native = module as Module;
  let call = native.binaryCall;
  if (!call) {
    const globals = globalThis as unknown as Record<string, unknown>;
    if (!globals[name]) {
      const error = native.installBinary?.();
      if (typeof error === "string") throw new SparkError("E_MODULE_UNAVAILABLE", error);
    }
    call = globals[name] as BinaryCall | undefined;
  }
  if (typeof call !== "function") throw new SparkError("E_MODULE_UNAVAILABLE", "Native binary transport is unavailable");
  return call(method, JSON.stringify(args), bytes?.buffer as ArrayBuffer | undefined, bytes?.byteOffset, bytes?.byteLength);
}
export function nativeBytes(value: unknown, maximum = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (!(value instanceof ArrayBuffer) || value.byteLength > maximum) throw new SparkError("E_INVALID_DATA", "Invalid native byte buffer");
  return new Uint8Array(value);
}
