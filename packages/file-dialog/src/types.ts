/** Filters accept extensions without a dot (for example "txt"). MIME types and UTIs are not supported. */
export interface FileFilter { extensions: readonly string[] }
export interface FileDialogOptions {
  directory?: string;
  /** Filters are combined into one allowed-extension set. An empty array allows all files. */
  filters?: readonly FileFilter[];
}
export interface OpenFileDialogOptions extends FileDialogOptions {
  selection?: "files" | "directories";
  multiple?: boolean;
  title?: string;
  message?: string;
  prompt?: string;
  /** macOS can select files and directories in the same panel. Ignored on other targets. */
  macos?: { mixedSelection?: boolean };
}
export interface SaveFileDialogOptions extends FileDialogOptions { defaultName?: string }
export type OpenFileDialogResult = { canceled: true } | { canceled: false; paths: string[] };
export type SaveFileDialogResult = { canceled: true } | { canceled: false; path: string };
