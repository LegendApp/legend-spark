/** Filters accept extensions without a dot (for example "txt"). MIME types and UTIs are not supported. */
export interface FileFilter {
  /** Display label for the filter group. Windows presents one labeled group per filter; macOS combines all extensions into one allowed set, so the label is ignored there. */
  name?: string;
  extensions: readonly string[];
}
export interface FileDialogOptions {
  /** Attach to this live Spark window. Omitted presents an unowned dialog. */
  windowId?: string;
  /** Absolute starting path. A directory starts there; for save it may name a file, which also suggests `defaultName`. */
  defaultPath?: string;
  /** macOS combines filters into one allowed-extension set; Windows keeps each labeled group. An empty array allows all files. */
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
