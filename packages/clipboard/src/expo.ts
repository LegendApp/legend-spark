import * as Clipboard from "expo-clipboard";
import { SparkError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { StringFormat } from "./formats";
import { RICH_CLIPBOARD_FEATURES, stringOptions } from "./options";
import type {
  ClipboardChangeEvent, ClipboardChangeOptions, ClipboardContent, ClipboardWriteContent, ClipboardWriteOptions, GetStringOptions, PromisedClipboardContent, PromisedClipboardOptions,
  RichClipboardFeature, SetStringOptions,
} from "./types";
export { StringFormat } from "./formats";
export type {
  ClipboardChangeEvent, ClipboardChangeOptions, ClipboardContent, ClipboardData, ClipboardDataType, ClipboardWriteContent, ClipboardWriteOptions, ClipboardImage, GetStringOptions,
  PromisedClipboardContent, PromisedClipboardOptions, RichClipboardFeature, SetStringOptions,
} from "./types";
export async function getStringAsync(options: GetStringOptions = {}): Promise<string> {
  const format = stringOptions(options, "preferredFormat");
  return Clipboard.getStringAsync({ preferredFormat: format === StringFormat.HTML ? Clipboard.StringFormat.HTML : Clipboard.StringFormat.PLAIN_TEXT });
}
export async function setStringAsync(text: string, options: SetStringOptions = {}): Promise<boolean> {
  const format = stringOptions(options, "inputFormat");
  return Clipboard.setStringAsync(text, { inputFormat: format === StringFormat.HTML ? Clipboard.StringFormat.HTML : Clipboard.StringFormat.PLAIN_TEXT });
}
export const hasStringAsync = Clipboard.hasStringAsync;
export function getRichClipboardAvailability(feature?: RichClipboardFeature): Availability {
  if (feature !== undefined && !RICH_CLIPBOARD_FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown clipboard feature");
  return { available: false, reason: "unsupported-platform" };
}
function unavailable(): never { throw new SparkError("E_UNSUPPORTED_PLATFORM", "Rich clipboard operations require a desktop host"); }
export async function readClipboard(): Promise<ClipboardContent> { return unavailable(); }
export async function getClipboardFormats(): Promise<string[]> { return unavailable(); }
export async function clearClipboard(): Promise<void> { return unavailable(); }
export async function writeClipboard(_content: ClipboardWriteContent, _options?: ClipboardWriteOptions): Promise<void> { return unavailable(); }
export async function writePromisedClipboard(_content: PromisedClipboardContent, _options?: PromisedClipboardOptions): Promise<void> { return unavailable(); }
export async function getClipboardChangeCount(): Promise<number> { return unavailable(); }
export async function onClipboardChange(_handler: (event: ClipboardChangeEvent) => void, _options?: ClipboardChangeOptions): Promise<AsyncRegistration> { return unavailable(); }
