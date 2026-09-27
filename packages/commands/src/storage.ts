import { createObservableFile } from "@legendapp/spark-settings/src/storage";

import {
  normalizeHotkeyFile,
  serializeHotkeyFilePatch,
  type HotkeyBindingLimitOptions,
  type HotkeyDefinition,
  type HotkeyFile,
} from "./index";

export function createHotkeyStore<HotkeyId extends string>({
  definitions,
  path,
  maxBindingsPerCommand,
}: {
  definitions: readonly HotkeyDefinition<HotkeyId>[];
  path: string;
} & HotkeyBindingLimitOptions) {
  const bindingLimitOptions = { maxBindingsPerCommand };
  const initialValue = normalizeHotkeyFile(undefined, definitions, bindingLimitOptions);
  return createObservableFile<HotkeyFile<HotkeyId>>({
    path,
    initialValue,
    decode: (value) => normalizeHotkeyFile(value, definitions, bindingLimitOptions),
    encode: (value) => serializeHotkeyFilePatch(value, definitions, bindingLimitOptions),
  });
}
