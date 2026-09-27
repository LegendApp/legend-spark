import * as SecureStore from "expo-secure-store";
import { validateItem, type SecureStoreOptions } from "./options";
export type { SecureStoreOptions } from "./options";
export const isAvailableAsync = SecureStore.isAvailableAsync;
export async function getItemAsync(key: string, options: SecureStoreOptions = {}): Promise<string | null> {
  validateItem(key, options); return SecureStore.getItemAsync(key);
}
export async function setItemAsync(key: string, value: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options); await SecureStore.setItemAsync(key, value);
}
export async function deleteItemAsync(key: string, options: SecureStoreOptions = {}): Promise<void> {
  validateItem(key, options); await SecureStore.deleteItemAsync(key);
}
