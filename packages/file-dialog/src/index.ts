import { absolutePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { Platform } from "react-native";
import { parseNativeResult, invokeNative } from "@legendapp/spark-desktop-app/src/contracts";
import { dialogOptions, isAccessoryValues } from "./options";
import { fileDialogNative } from "./native";
import type { DialogAccessoryControl, DialogAccessoryValues, OpenFileDialogOptions, OpenFileDialogResult, SaveFileDialogOptions, SaveFileDialogResult } from "./types";
export type { DialogAccessoryControl, DialogAccessoryOption, DialogAccessoryValues, FileDialogFeature, FileFilter, FileDialogOptions, OpenFileDialogOptions, OpenFileDialogResult, SaveFileDialogOptions, SaveFileDialogResult } from "./types";
export { getFileDialogAvailability } from "./native";

function isNativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.startsWith("file://")) return false;
  try { absolutePath(value, Platform.OS); return true; } catch { return false; }
}
const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isNativePath);

// With accessory controls the bridge answers { <selection>, accessory }; without them, the bare selection.
// Accessory values are returned in control order.
function selection<T>(json: string, key: "paths" | "path", controls: readonly DialogAccessoryControl[] | undefined, valid: (value: unknown) => value is T): { value: T; accessory?: DialogAccessoryValues } | null {
  if (!controls) {
    const value = parseNativeResult(json, (value): value is T | null => value === null || valid(value));
    return value === null ? null : { value };
  }
  const result = parseNativeResult(json, (value): value is Record<string, unknown> | null => value === null || (!!value && typeof value === "object" && valid((value as Record<string, unknown>)[key]) && isAccessoryValues((value as Record<string, unknown>).accessory, controls)));
  if (result === null) return null;
  const values = result.accessory as DialogAccessoryValues;
  return { value: result[key] as T, accessory: Object.fromEntries(controls.map(control => [control.id, values[control.id]!])) };
}

export async function openFileDialog(options: OpenFileDialogOptions = {}): Promise<OpenFileDialogResult> {
  const args = dialogOptions(options, "open", Platform.OS);
  const result = selection(await invokeNative(() => fileDialogNative().open(JSON.stringify(args))), "paths", args.accessory, isPaths);
  return result === null ? { canceled: true } : { canceled: false, paths: result.value, ...(result.accessory && { accessory: result.accessory }) };
}
export async function saveFileDialog(options: SaveFileDialogOptions = {}): Promise<SaveFileDialogResult> {
  const args = dialogOptions(options, "save", Platform.OS);
  const result = selection(await invokeNative(() => fileDialogNative().save(JSON.stringify(args))), "path", args.accessory, isNativePath);
  return result === null ? { canceled: true } : { canceled: false, path: result.value, ...(result.accessory && { accessory: result.accessory }) };
}
