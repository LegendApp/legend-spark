import { fromByteArray, toByteArray } from "base64-js";
import { readClipboard, writeClipboard } from "@legendapp/spark-clipboard";
export { getStringAsync, setStringAsync, hasStringAsync, StringFormat } from "@legendapp/spark-clipboard";
export type { GetStringOptions, SetStringOptions } from "@legendapp/spark-clipboard";
export enum ContentType { PLAIN_TEXT = "plain-text", HTML = "html", IMAGE = "image", URL = "url" }
export interface ClipboardEvent { contentTypes: ContentType[] }
export interface Subscription { remove(): void }
export interface GetImageOptions { format: "png" | "jpeg"; jpegQuality?: number }
export interface ClipboardImage { data: string; size: { width: number; height: number } }
function unavailable(feature: string): never {
  throw Object.assign(new Error(`Clipboard.${feature} is unavailable on macOS`), { code: "ERR_UNAVAILABLE" });
}
function size(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value) || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new TypeError("Clipboard expects PNG image data");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height) throw new TypeError("Invalid PNG dimensions");
  return { width, height };
}
export async function getImageAsync(options: GetImageOptions): Promise<ClipboardImage | null> {
  if (options?.format !== "png" || Object.keys(options).some(key => key !== "format")) unavailable("getImageAsync: only PNG is supported");
  const image = (await readClipboard()).image;
  return image ? { data: `data:image/png;base64,${fromByteArray(image.bytes)}`, size: size(image.bytes) } : null;
}
export async function setImageAsync(base64Image: string): Promise<void> {
  if (typeof base64Image !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Image)) throw new TypeError("Expected base64 PNG data without a MIME prefix");
  const bytes = toByteArray(base64Image);
  size(bytes);
  await writeClipboard({ image: { format: "png", bytes } });
}
export async function hasImageAsync(): Promise<boolean> { return !!(await readClipboard()).image; }
export function addClipboardListener(_listener: (event: ClipboardEvent) => void): never { return unavailable("addClipboardListener"); }
export function removeClipboardListener(subscription: Subscription): void { subscription.remove(); }
export function setString(_text: string): never { return unavailable("setString: use setStringAsync"); }
export async function getUrlAsync(): Promise<string | null> { return unavailable("getUrlAsync"); }
export async function setUrlAsync(_url: string): Promise<void> { return unavailable("setUrlAsync"); }
export async function hasUrlAsync(): Promise<boolean> { return unavailable("hasUrlAsync"); }
export const isPasteButtonAvailable = false;
export function ClipboardPasteButton(): never { return unavailable("ClipboardPasteButton"); }
