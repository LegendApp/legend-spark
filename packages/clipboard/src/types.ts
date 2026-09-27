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
