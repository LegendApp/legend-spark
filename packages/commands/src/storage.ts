import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { ObservableFile } from "@legendapp/spark-settings/src/storage";
import type { SettingsStorage } from "@legendapp/spark-settings/src/store";
import { normalizeHotkeyFile, serializeHotkeyFile, type HotkeyBindingLimitOptions, type HotkeyDefinition, type HotkeyFile } from "./bindings";
export interface HotkeyStoreOptions<Id extends string> extends HotkeyBindingLimitOptions {
  definitions: readonly HotkeyDefinition<Id>[];
  path: string;
  storage?: SettingsStorage;
  debounceMs?: number;
}
export async function createHotkeyStore<Id extends string>(options: HotkeyStoreOptions<Id>): Promise<ObservableFile<HotkeyFile<Id>>> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected hotkey store options");
  for (const key of Object.keys(options)) if (!["definitions", "path", "maxBindingsPerCommand", "storage", "debounceMs"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown hotkey store option: ${key}`);
  const { definitions, path, maxBindingsPerCommand, storage, debounceMs } = options;
  const limit = { maxBindingsPerCommand };
  const initialValue = normalizeHotkeyFile(undefined, definitions, limit);
  const snapshot = definitions.map(definition => ({ ...definition, defaultBindings: [...definition.defaultBindings] }));
  const { createObservableFile } = await import("@legendapp/spark-settings/src/storage");
  return createObservableFile({ path, initialValue, storage, debounceMs, decode: value => normalizeHotkeyFile(value, snapshot, limit), encode: value => serializeHotkeyFile(value, snapshot, limit) });
}
