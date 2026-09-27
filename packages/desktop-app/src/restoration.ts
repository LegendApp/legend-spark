import { Platform, TurboModuleRegistry, type TurboModule } from "react-native";
interface RestorationNative extends TurboModule { finishWindowRestoration(): Promise<string> }
import { SparkError, invokeNative, parseNativeResult } from "./contracts";
/** Call after application restoration to discard startup shells no document adopted. */
export async function finishWindowRestoration(): Promise<void> {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Native window-shell restoration requires macOS");
  const native = TurboModuleRegistry.get<RestorationNative>("NativeWindowManager");
  if (!native) throw new SparkError("E_MODULE_UNAVAILABLE", "Native window restoration is unavailable");
  const result = parseNativeResult(await invokeNative(() => native.finishWindowRestoration()), (value): value is { success: boolean } => !!value && typeof value === "object" && typeof (value as any).success === "boolean");
  if (!result.success) throw new SparkError("E_NATIVE", "Could not finish native window restoration");
}
