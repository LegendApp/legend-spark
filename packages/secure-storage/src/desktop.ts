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
/** Stores a string under `key`, replacing any value there: the Keychain on macOS, Credential Manager on Windows. Keys are 1-200 letters, digits, '.', '-' or '_' (E_INVALID_ARGUMENT); options are not supported (E_UNSUPPORTED_OPTION). */
export async function setItemAsync(key: string, value: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options);
  if (typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "SecureStore values must be strings");
  await call("set", { key, value }, (value): value is null => value === null);
}
/** Deletes the value stored under `key`. Deleting a missing key succeeds. */
export async function deleteItemAsync(key: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options); await call("remove", { key }, (value): value is null => value === null);
}
/** Whether secure storage works here: macOS or Windows with NativeDesktopSecureStorage installed. Never rejects. */
export async function isAvailableAsync(): Promise<boolean> { return (Platform.OS === "macos" || Platform.OS === "windows") && !!Native; }
