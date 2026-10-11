import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import type { DialogAccessoryControl, OpenFileDialogOptions, SaveFileDialogOptions } from "./types";

const ACCESSORY_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const invalid = (message: string) => new SparkError("E_INVALID_ARGUMENT", message);

/** Validates accessory controls and returns a fresh copy for the native bridge. */
export function accessoryControls(value: unknown, platform: string): DialogAccessoryControl[] {
  if (platform === "windows") throw new SparkError("E_UNSUPPORTED_OPTION", "Dialog accessory controls are not supported on Windows");
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw invalid("accessory must list 1–8 controls");
  const controls = value.map((control: DialogAccessoryControl): DialogAccessoryControl => {
    if (!control || typeof control !== "object") throw invalid("Expected an accessory control");
    const allowed = control.type === "checkbox" ? ["type", "id", "label", "checked"] : control.type === "popup" ? ["type", "id", "label", "options", "value"] : undefined;
    if (!allowed) throw invalid("Accessory control type must be checkbox or popup");
    for (const key of Object.keys(control)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported accessory option: ${key}`);
    if (typeof control.id !== "string" || !ACCESSORY_ID.test(control.id)) throw invalid("Accessory control IDs are 1–64 letters, digits, _ or -");
    if (!text(control.label)) throw invalid("Accessory controls need a label without NULs");
    if (control.type === "checkbox") {
      if (control.checked !== undefined && typeof control.checked !== "boolean") throw invalid("checked must be boolean");
      return { type: "checkbox", id: control.id, label: control.label, checked: control.checked ?? false };
    }
    const options = control.options;
    if (!Array.isArray(options) || options.length < 1 || options.length > 64 || options.some(option => !option || Object.keys(option).some(key => key !== "value" && key !== "label") || !text(option.value) || !text(option.label))) throw invalid("Pop-up options need 1–64 entries with a value and label");
    if (!unique(options.map(option => option.value)) || !unique(options.map(option => option.label))) throw invalid("Pop-up option values and labels must be unique");
    if (control.value !== undefined && !options.some(option => option.value === control.value)) throw invalid("Pop-up value must identify an option");
    return { type: "popup", id: control.id, label: control.label, options: options.map(option => ({ value: option.value, label: option.label })), value: control.value ?? options[0]!.value };
  });
  if (!unique(controls.map(control => control.id))) throw invalid("Accessory control IDs must be unique");
  return controls;
}

/** True when native accessory values name every control once with a value of its type. */
export function isAccessoryValues(value: unknown, controls: readonly DialogAccessoryControl[]): value is Record<string, boolean | string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== controls.length) return false;
  const values = value as Record<string, unknown>;
  return controls.every(control => control.type === "checkbox" ? typeof values[control.id] === "boolean" : control.options.some(option => option.value === values[control.id]));
}

export function dialogOptions(options: OpenFileDialogOptions | SaveFileDialogOptions, kind: "open" | "save", platform: string) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected dialog options");
  const allowed = new Set(["windowId", "defaultPath", "filters", "accessory", ...(kind === "open" ? ["selection", "multiple", "title", "message", "prompt", "macos"] : ["defaultName"])]);
  for (const [key, value] of Object.entries(options)) {
    if (!allowed.has(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported dialog option: ${key}`);
    if (value === undefined) continue;
    if (["defaultPath", "title", "message", "prompt", "defaultName"].includes(key) && (typeof value !== "string" || value.includes("\0"))) throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a string without NUL characters`);
  }
  if (options.windowId !== undefined && (typeof options.windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid dialog owner window ID");
  const windowId = options.windowId;
  // defaultPath may name a file for save dialogs. Only native hosts can tell a
  // live directory from a proposed filename, so JS forwards the decoded path and
  // each bridge splits it: the file part suggests defaultName unless one is given.
  const directory = options.defaultPath === undefined ? undefined : nativePath(options.defaultPath, platform);
  let filters: { name?: string; extensions: string[] }[] | undefined;
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters)) throw new SparkError("E_INVALID_ARGUMENT", "filters must be an array");
    filters = [];
    for (const filter of options.filters) {
      if (!filter || Object.keys(filter).some(key => key !== "name" && key !== "extensions") || (filter.name !== undefined && (typeof filter.name !== "string" || !filter.name.trim() || filter.name.includes("\0"))) || !Array.isArray(filter.extensions) || !filter.extensions.length || filter.extensions.some((ext: unknown) => typeof ext !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(ext))) throw new SparkError("E_INVALID_ARGUMENT", "Filters need file extensions without dots, MIME types, or wildcards, and a name without NULs when given");
      filters.push({ ...(filter.name === undefined ? {} : { name: filter.name }), extensions: [...filter.extensions] });
    }
  }
  const allowedFileTypes = filters?.flatMap(filter => filter.extensions);
  const accessory = options.accessory === undefined ? undefined : accessoryControls(options.accessory, platform);
  if (kind === "save") return { windowId, directory, filters, allowedFileTypes, defaultName: (options as SaveFileDialogOptions).defaultName, accessory };
  const open = options as OpenFileDialogOptions;
  if (open.selection !== undefined && !["files", "directories"].includes(open.selection)) throw new SparkError("E_INVALID_ARGUMENT", "selection must be files or directories");
  if (open.multiple !== undefined && typeof open.multiple !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "multiple must be boolean");
  if (platform === "macos" && open.macos !== undefined && (!open.macos || typeof open.macos !== "object" || Object.keys(open.macos).some(key => key !== "mixedSelection") || (open.macos.mixedSelection !== undefined && typeof open.macos.mixedSelection !== "boolean"))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid macOS dialog options");
  const mixed = platform === "macos" && open.macos?.mixedSelection === true;
  return { windowId, directoryURL: directory, filters, allowedFileTypes, canChooseFiles: mixed || open.selection !== "directories", canChooseDirectories: mixed || open.selection === "directories", allowsMultipleSelection: open.multiple ?? false, title: open.title, message: open.message, prompt: open.prompt, accessory };
}
