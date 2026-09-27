import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { SecureStoreOptions } from "./options";
export type { SecureStoreOptions } from "./options";
export async function isAvailableAsync(): Promise<boolean> { return false; }
function unavailable(): never { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Secure storage is unavailable on this platform"); }
export async function getItemAsync(_key: string, _options?: SecureStoreOptions): Promise<string | null> { return unavailable(); }
export async function setItemAsync(_key: string, _value: string, _options?: SecureStoreOptions): Promise<void> { return unavailable(); }
export async function deleteItemAsync(_key: string, _options?: SecureStoreOptions): Promise<void> { return unavailable(); }
