/** Filters accept extensions without a dot (for example "txt"). MIME types and UTIs are not supported. */
export interface FileFilter {
  /** Display label for the filter group. Windows presents one labeled group per filter; macOS combines all extensions into one allowed set, so the label is ignored there. */
  name?: string;
  extensions: readonly string[];
}
export interface DialogAccessoryOption { value: string; label: string }
/**
 * A native control in the dialog's accessory area. Its final value returns with an accepted
 * result under its `id`, which is also the control's accessibility identifier.
 */
export type DialogAccessoryControl =
  | { type: "checkbox"; id: string; label: string; checked?: boolean }
  /** A labeled pop-up button; `value` selects an option (default: the first). */
  | { type: "popup"; id: string; label: string; options: readonly DialogAccessoryOption[]; value?: string };
/** Checkbox IDs map to booleans, pop-up IDs to the selected option's value, in control order. */
export type DialogAccessoryValues = Readonly<Record<string, boolean | string>>;
/** Features beyond the base open/save panels, for `getFileDialogAvailability(feature)`. */
export type FileDialogFeature = "accessory";
export interface FileDialogOptions {
  /** Attach to this live Spark window. Omitted presents an unowned dialog. */
  windowId?: string;
  /** Absolute starting path. A directory starts there; for save it may name a file, which also suggests `defaultName`. */
  defaultPath?: string;
  /** macOS combines filters into one allowed-extension set; Windows keeps each labeled group. An empty array allows all files. */
  filters?: readonly FileFilter[];
  /** 1–8 controls shown below the file browser (macOS). Check `getFileDialogAvailability("accessory")`; other targets reject E_UNSUPPORTED_OPTION. */
  accessory?: readonly DialogAccessoryControl[];
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
/** `accessory` is present only when the options supplied accessory controls. */
export type OpenFileDialogResult = { canceled: true } | { canceled: false; paths: string[]; accessory?: DialogAccessoryValues };
export type SaveFileDialogResult = { canceled: true } | { canceled: false; path: string; accessory?: DialogAccessoryValues };
