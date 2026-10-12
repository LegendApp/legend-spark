/** Load the native view only after the caller has established availability. */
export function getNativeMotionView(): typeof import("./SparkMotionViewNativeComponent").default {
  return (require("./SparkMotionViewNativeComponent") as typeof import("./SparkMotionViewNativeComponent")).default;
}
export function getNativeMotionSymbol(): typeof import("./SparkMotionSymbolNativeComponent").default {
  return (require("./SparkMotionSymbolNativeComponent") as typeof import("./SparkMotionSymbolNativeComponent")).default;
}
