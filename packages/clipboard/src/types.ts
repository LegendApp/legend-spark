import type { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { StringFormat } from "./formats";
export type GetStringOptions = { preferredFormat?: StringFormat };
export type SetStringOptions = { inputFormat?: StringFormat };
export interface ClipboardImage { format: "png"; bytes: Uint8Array }
/** Reading preserves all OS representations, which can coexist. */
export interface ClipboardContent { text?: string; html?: string; rtf?: string; image?: ClipboardImage; files?: readonly string[] }
/** File lists must be written separately from text/image representations. */
export type ClipboardWriteContent =
  | { files: readonly string[]; text?: never; html?: never; rtf?: never; image?: never }
  | { files?: never; text?: string; html?: string; rtf?: string; image?: ClipboardImage };
/** Markers clipboard managers and clipboard history honor (nspasteboard.org). */
export interface ClipboardWriteOptions {
  /** The data is sensitive (a password): clipboard managers do not record or show it. */
  concealed?: boolean;
  /** The data is temporary (an app's own intermediate copy): clipboard managers ignore it. */
  transient?: boolean;
}
/** A representation that promised data can provide: `png` is PNG bytes, the others strings. */
export type ClipboardDataType = "text" | "html" | "rtf" | "png";
export type ClipboardData<T extends ClipboardDataType = ClipboardDataType> = T extends "png" ? Uint8Array : string;
export interface PromisedClipboardContent {
  /** The representations on offer; none is produced until something pastes it. */
  types: readonly ClipboardDataType[];
  /** Produces one representation when a paste asks for it, in this app or another. Called at most once per type. */
  provide(type: ClipboardDataType): ClipboardData | Promise<ClipboardData>;
}
export interface PromisedClipboardOptions extends ClipboardWriteOptions {
  /** How long a paste waits for `provide`, 1–30000 ms (default 5000); the paste then gets nothing. */
  timeoutMs?: number;
  /** `provide` threw, returned the wrong kind of data, or was too late (E_TIMEOUT). Without it, the error is rethrown asynchronously. */
  onError?: (error: SparkError) => void;
}
export interface ClipboardChangeEvent {
  /** The pasteboard's change count after the change; compare with getClipboardChangeCount(). */
  changeCount: number;
}
export interface ClipboardChangeOptions {
  /** How often to look for a change, 100–10000 ms (default 500). Subscriptions share the shortest interval. */
  intervalMs?: number;
}
/** Rich clipboard features whose platform support differs. */
export type RichClipboardFeature = "promisedData" | "changeEvents" | "privacyMarkers";
