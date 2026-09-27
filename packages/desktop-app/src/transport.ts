import { Platform, TurboModuleRegistry } from "react-native";
import type { Spec } from "./NativeDesktopApp";
import { SparkError, invokeNative, parseNativeResult } from "./contracts";
/** Internal native transport; each feature supplies its own response validator. */
export async function callAppNative<T>(method: string, validate: (value: unknown) => value is T, args: object = {}): Promise<T> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Desktop application APIs require a desktop host");
  const native = TurboModuleRegistry.get<Spec>("NativeDesktopApp");
  if (!native) throw new SparkError("E_MODULE_UNAVAILABLE", "Desktop application module is unavailable");
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}
