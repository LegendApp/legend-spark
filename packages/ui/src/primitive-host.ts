/** Load the native view only after the caller has established availability. */
export function getNativePrimitive(): typeof import("./SparkPrimitiveNativeComponent").default {
  return (require("./SparkPrimitiveNativeComponent") as typeof import("./SparkPrimitiveNativeComponent")).default;
}
