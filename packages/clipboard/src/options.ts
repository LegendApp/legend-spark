import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { StringFormat } from "./formats";
export function stringOptions(options: object, key: string): StringFormat {
  if (!options || typeof options !== "object" || Object.keys(options).some(name => name !== key)) throw new SparkError("E_UNSUPPORTED_OPTION", "Unsupported clipboard option");
  const format = (options as Record<string, unknown>)[key] ?? StringFormat.PLAIN_TEXT;
  if (format !== StringFormat.PLAIN_TEXT && format !== StringFormat.HTML) throw new SparkError("E_INVALID_ARGUMENT", "Invalid clipboard string format");
  return format;
}
/** Rejects anything but an options object with known keys. */
export function knownOptions(options: object, keys: readonly string[]): Record<string, unknown> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected clipboard options");
  for (const key of Object.keys(options)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported clipboard option: ${key}`);
  return options as Record<string, unknown>;
}
/** `value` when it is an integer in [minimum, maximum], `fallback` when undefined. */
export function integerOption(value: unknown, name: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be an integer from ${minimum} to ${maximum}`);
  return value as number;
}
export const RICH_CLIPBOARD_FEATURES = ["promisedData", "changeEvents", "privacyMarkers"] as const;
