import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { SelectProps } from "./types";
export function selectionIndex(options: SelectProps["options"], value: string): number {
  if (!Array.isArray(options) || !options.length || Array.from(options).some(option => !option || typeof option !== "object" || typeof option.label !== "string" || !option.label.length || typeof option.value !== "string") || new Set(options.map(option => option.value)).size !== options.length) throw new SparkError("E_INVALID_ARGUMENT", "Select options must have nonempty labels and unique string values");
  for (const option of options) for (const key of Object.keys(option)) if (key !== "label" && key !== "value") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown select option: ${key}`);
  const index = options.findIndex(option => option.value === value);
  if (index < 0) throw new SparkError("E_INVALID_ARGUMENT", "Select value must match an option");
  return index;
}
