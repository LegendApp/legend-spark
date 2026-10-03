import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import type { OpenFileDialogOptions, SaveFileDialogOptions } from "./types";

export function dialogOptions(options: OpenFileDialogOptions | SaveFileDialogOptions, kind: "open" | "save", platform: string) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected dialog options");
  const allowed = new Set(["windowId", "defaultPath", "filters", ...(kind === "open" ? ["selection", "multiple", "title", "message", "prompt", "macos"] : ["defaultName"])]);
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
  if (kind === "save") return { windowId, directory, filters, allowedFileTypes, defaultName: (options as SaveFileDialogOptions).defaultName };
  const open = options as OpenFileDialogOptions;
  if (open.selection !== undefined && !["files", "directories"].includes(open.selection)) throw new SparkError("E_INVALID_ARGUMENT", "selection must be files or directories");
  if (open.multiple !== undefined && typeof open.multiple !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "multiple must be boolean");
  if (platform === "macos" && open.macos !== undefined && (!open.macos || typeof open.macos !== "object" || Object.keys(open.macos).some(key => key !== "mixedSelection") || (open.macos.mixedSelection !== undefined && typeof open.macos.mixedSelection !== "boolean"))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid macOS dialog options");
  const mixed = platform === "macos" && open.macos?.mixedSelection === true;
  return { windowId, directoryURL: directory, filters, allowedFileTypes, canChooseFiles: mixed || open.selection !== "directories", canChooseDirectories: mixed || open.selection === "directories", allowsMultipleSelection: open.multiple ?? false, title: open.title, message: open.message, prompt: open.prompt };
}
