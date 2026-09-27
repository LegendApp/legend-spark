import * as Clipboard from "expo-clipboard";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { StringFormat } from "./formats";
import { stringOptions } from "./options";
import type { ClipboardContent, ClipboardWriteContent, GetStringOptions, SetStringOptions } from "./types";
export { StringFormat } from "./formats";
export type { ClipboardContent, ClipboardWriteContent, ClipboardImage, GetStringOptions, SetStringOptions } from "./types";
export async function getStringAsync(options: GetStringOptions = {}): Promise<string> {
  const format = stringOptions(options, "preferredFormat");
  return Clipboard.getStringAsync({ preferredFormat: format === StringFormat.HTML ? Clipboard.StringFormat.HTML : Clipboard.StringFormat.PLAIN_TEXT });
}
export async function setStringAsync(text: string, options: SetStringOptions = {}): Promise<boolean> {
  const format = stringOptions(options, "inputFormat");
  return Clipboard.setStringAsync(text, { inputFormat: format === StringFormat.HTML ? Clipboard.StringFormat.HTML : Clipboard.StringFormat.PLAIN_TEXT });
}
export const hasStringAsync = Clipboard.hasStringAsync;
export function getRichClipboardAvailability(): Availability { return { available: false, reason: "unsupported-platform" }; }
function unavailable(): never { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Rich clipboard operations require a desktop host"); }
export async function readClipboard(): Promise<ClipboardContent> { return unavailable(); }
export async function getClipboardFormats(): Promise<string[]> { return unavailable(); }
export async function clearClipboard(): Promise<void> { return unavailable(); }
export async function writeClipboard(_content: ClipboardWriteContent): Promise<void> { return unavailable(); }
