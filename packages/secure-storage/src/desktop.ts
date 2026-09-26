import { Platform } from "react-native";
import Native from "./NativeDesktopSecureStorage";
function key(value: string) { if (!value.length || value.length > 200) throw new Error("Keychain keys must contain 1–200 characters"); return value; }
async function call<T = void>(method: string, args: object): Promise<T> { return JSON.parse(await Native.call(method, JSON.stringify(args))) as T; }
export const secureStorage = {
  get: (name: string) => call<string | null>("get", { key: key(name) }),
  set: (name: string, value: string) => call("set", { key: key(name), value }),
  remove: (name: string) => call("remove", { key: key(name) }),
};

import { validateItem, type SecureStoreOptions } from "./options";
export type { SecureStoreOptions } from "./options";
/** Basic Expo SecureStore subset; desktop service identity stays project-scoped. */
export async function getItemAsync(key: string, options: SecureStoreOptions = {}): Promise<string | null> {
  validateItem(key, options); return secureStorage.get(key);
}
export async function setItemAsync(key: string, value: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options);
  if (typeof value !== "string") throw new TypeError("SecureStore values must be strings");
  await secureStorage.set(key, value);
}
export async function deleteItemAsync(key: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options); await secureStorage.remove(key);
}
export async function isAvailableAsync(): Promise<boolean> { return true; }

export type SecureStorage = {
  get(service: string, key: string): string;
  set(service: string, key: string, value: string): void;
  remove(service: string, key: string): void;
  randomBase64Url(byteCount: number): string;
};
function sync<T>(method: string, args: object): T {
  const result = JSON.parse(Native.callSync(method, JSON.stringify(args)));
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
const serviceStorage: SecureStorage = {
  get: (service, name) => sync<string | null>("get", { service, key: key(name) }) ?? "",
  set: (service, name, value) => sync("set", { service, key: key(name), value }),
  remove: (service, name) => sync("remove", { service, key: key(name) }),
  randomBase64Url: count => {
    if (!Number.isInteger(count) || count < 16 || count > 1024) throw new TypeError("Random byte count must be an integer between 16 and 1024");
    return sync("random", { count });
  },
};
/** Synchronous desktop access. Custom services must be declared in SparkKeychainServices. */
export function getSecureStorage(): SecureStorage {
  if (Platform.OS !== "macos") throw new Error("Synchronous service-based keychain access requires macOS; use secureStorage on other desktops");
  return serviceStorage;
}
