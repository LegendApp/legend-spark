import { Platform } from "react-native";
import { SparkError, parseNativeResult, invokeNative } from "@legendapp/spark-desktop-app/src/contracts";
import Native from "./NativeDesktopSecureStorage";
import { validateItem, type SecureStoreOptions } from "./options";
export type { SecureStoreOptions } from "./options";
function native() {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Desktop secure storage is unavailable on this target");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "NativeDesktopSecureStorage is not installed");
  return Native;
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), validate);
}
/** Selected Expo subset; service identity is project-scoped. Missing is null, including on desktop. */
export async function getItemAsync(key: string, options: SecureStoreOptions = {}): Promise<string | null> {
  validateItem(key, options); return call("get", { key }, (value): value is string | null => value === null || typeof value === "string");
}
export async function setItemAsync(key: string, value: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options);
  if (typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "SecureStore values must be strings");
  await call("set", { key, value }, (value): value is null => value === null);
}
export async function deleteItemAsync(key: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options); await call("remove", { key }, (value): value is null => value === null);
}
export async function isAvailableAsync(): Promise<boolean> { return (Platform.OS === "macos" || Platform.OS === "windows") && !!Native; }
