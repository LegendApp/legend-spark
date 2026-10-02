import { Platform } from "react-native";
import { callBinary, nativeBytes } from "@legendapp/spark-desktop-app/src/contracts/native-buffer";
import { SparkError, parseNativeResult, invokeNative, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native from "./NativeDesktopClipboard";
import { stringOptions } from "./options";
import type { ClipboardContent, ClipboardWriteContent, GetStringOptions, SetStringOptions } from "./types";
export { StringFormat } from "./formats";
export type { ClipboardContent, ClipboardWriteContent, ClipboardImage, GetStringOptions, SetStringOptions } from "./types";
export function getRichClipboardAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getRichClipboardAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Desktop clipboard module is unavailable");
  return Native!;
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), validate);
}
const isVoid = (value: unknown): value is null => value === null;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
/** Expo-compatible text/HTML subset. */
export async function getStringAsync(options: GetStringOptions = {}): Promise<string> {
  return call("getString", { format: stringOptions(options, "preferredFormat") }, (value): value is string => typeof value === "string");
}
export async function setStringAsync(text: string, options: SetStringOptions = {}): Promise<boolean> {
  if (typeof text !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Clipboard text must be a string");
  return call("setString", { text, format: stringOptions(options, "inputFormat") }, isBoolean);
}
export async function hasStringAsync(): Promise<boolean> { return call("hasString", {}, (value): value is boolean => typeof value === "boolean"); }
export async function readClipboard(): Promise<ClipboardContent> {
  const raw = await invokeNative(() => callBinary(native(), "__sparkClipboardBinary", "read", {})) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SparkError("E_INVALID_DATA", "Invalid clipboard content");
  const result: ClipboardContent = {};
  for (const key of ["text", "html", "rtf"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") throw new SparkError("E_INVALID_DATA", `Invalid clipboard ${key}`);
    if (typeof raw[key] === "string") result[key] = raw[key];
  }
  if (raw.files !== undefined) {
    if (!Array.isArray(raw.files) || raw.files.some(value => typeof value !== "string")) throw new SparkError("E_INVALID_DATA", "Invalid clipboard files");
    try { result.files = raw.files.map(value => nativePath(value, Platform.OS)); }
    catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid clipboard file paths", { cause }); }
  }
  if (raw.imagePNG !== undefined) {
    result.image = { format: "png", bytes: nativeBytes(raw.imagePNG) };
  }
  return result;
}
export async function getClipboardFormats(): Promise<string[]> { return call("formats", {}, (value): value is string[] => Array.isArray(value) && value.every(format => typeof format === "string")); }
export async function clearClipboard(): Promise<void> { await call("clear", {}, isVoid); }
export async function writeClipboard(content: ClipboardWriteContent): Promise<void> {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new SparkError("E_INVALID_ARGUMENT", "Expected clipboard content");
  for (const key of Object.keys(content)) if (!["text", "html", "rtf", "image", "files"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown clipboard format: ${key}`);
  for (const key of ["text", "html", "rtf"] as const) if (content[key] !== undefined && typeof content[key] !== "string") throw new SparkError("E_INVALID_ARGUMENT", `Invalid clipboard ${key}`);
  if (content.files !== undefined && (!Array.isArray(content.files) || Object.entries(content).some(([key, value]) => key !== "files" && value !== undefined))) throw new SparkError("E_INVALID_ARGUMENT", "Files must be written separately from other formats");
  const files = content.files?.map(path => nativePath(path, Platform.OS));
  const { image, ...rest } = content;
  if (image !== undefined && (!image || image.format !== "png" || !(image.bytes instanceof Uint8Array))) throw new SparkError("E_INVALID_ARGUMENT", "Expected PNG image bytes");
  const response = await invokeNative(() => callBinary(native(), "__sparkClipboardBinary", "write", { ...rest, files }, image?.bytes));
  if (response !== null) throw new SparkError("E_INVALID_DATA", "Invalid native clipboard response");
}
