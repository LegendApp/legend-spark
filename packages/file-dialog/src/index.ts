import { absolutePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { Platform } from "react-native";
import { parseNativeResult, invokeNative } from "@legendapp/spark-desktop-app/src/contracts";
import { dialogOptions } from "./options";
import { fileDialogNative } from "./native";
import type { OpenFileDialogOptions, OpenFileDialogResult, SaveFileDialogOptions, SaveFileDialogResult } from "./types";
export type { FileFilter, FileDialogOptions, OpenFileDialogOptions, OpenFileDialogResult, SaveFileDialogOptions, SaveFileDialogResult } from "./types";
export { getFileDialogAvailability } from "./native";

function isNativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.startsWith("file://")) return false;
  try { absolutePath(value, Platform.OS); return true; } catch { return false; }
}

export async function openFileDialog(options: OpenFileDialogOptions = {}): Promise<OpenFileDialogResult> {
  const args = dialogOptions(options, "open", Platform.OS);
  const paths = parseNativeResult(await invokeNative(() => fileDialogNative().open(JSON.stringify(args))), (value): value is string[] | null => value === null || (Array.isArray(value) && value.length > 0 && value.every(isNativePath)));
  return paths === null ? { canceled: true } : { canceled: false, paths };
}
export async function saveFileDialog(options: SaveFileDialogOptions = {}): Promise<SaveFileDialogResult> {
  const args = dialogOptions(options, "save", Platform.OS);
  const path = parseNativeResult(await invokeNative(() => fileDialogNative().save(JSON.stringify(args))), (value): value is string | null => value === null || isNativePath(value));
  return path === null ? { canceled: true } : { canceled: false, path };
}
