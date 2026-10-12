import { Platform } from "react-native";
import { callAppNative } from "./transport";

/**
 * Spark's own strings (desktop-app/macos/Localization) in the language this launch chose for the app,
 * keyed by their English text. Features use them for labels a caller omits. On Windows they are the
 * English text: Spark's Windows host does not localize its strings yet (#329).
 */
export function frameworkStrings<K extends string>(keys: readonly K[]): Promise<Record<K, string>> {
  if (Platform.OS !== "macos") return Promise.resolve(Object.fromEntries(keys.map(key => [key, key as string])) as Record<K, string>);
  return callAppNative("strings", (value): value is Record<K, string> => !!value && typeof value === "object" && keys.every(key => typeof (value as Record<string, unknown>)[key] === "string"), { keys });
}
