import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { absolutePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import type { OpenFileDialogOptions, SaveFileDialogOptions } from "./types";

export function dialogOptions(options: OpenFileDialogOptions | SaveFileDialogOptions, kind: "open" | "save", platform: string) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected dialog options");
  const allowed = new Set(["directory", "filters", ...(kind === "open" ? ["selection", "multiple", "title", "message", "prompt", "macos"] : ["defaultName"])]);
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (!allowed.has(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported dialog option: ${key}`);
    if (["directory", "title", "message", "prompt", "defaultName"].includes(key) && (typeof value !== "string" || value.includes("\0"))) throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a string without NUL characters`);
  }
  if (options.directory !== undefined) absolutePath(options.directory, platform);
  let extensions: string[] | undefined;
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters)) throw new SparkError("E_INVALID_ARGUMENT", "filters must be an array");
    extensions = [];
    for (const filter of options.filters) {
      if (!filter || Object.keys(filter).some(key => key !== "extensions") || !Array.isArray(filter.extensions) || !filter.extensions.length || filter.extensions.some((ext: unknown) => typeof ext !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(ext))) throw new SparkError("E_INVALID_ARGUMENT", "Filters require file extensions without dots, MIME types, or wildcards");
      extensions.push(...filter.extensions);
    }
  }
  if (kind === "save") return { directory: options.directory, allowedFileTypes: extensions, defaultName: (options as SaveFileDialogOptions).defaultName };
  const open = options as OpenFileDialogOptions;
  if (open.selection !== undefined && !["files", "directories"].includes(open.selection)) throw new SparkError("E_INVALID_ARGUMENT", "selection must be files or directories");
  if (open.multiple !== undefined && typeof open.multiple !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "multiple must be boolean");
  if (platform === "macos" && open.macos !== undefined && (!open.macos || typeof open.macos !== "object" || Object.keys(open.macos).some(key => key !== "mixedSelection") || (open.macos.mixedSelection !== undefined && typeof open.macos.mixedSelection !== "boolean"))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid macOS dialog options");
  const mixed = platform === "macos" && open.macos?.mixedSelection === true;
  return { directoryURL: options.directory, allowedFileTypes: extensions, canChooseFiles: mixed || open.selection !== "directories", canChooseDirectories: mixed || open.selection === "directories", allowsMultipleSelection: open.multiple ?? false, title: open.title, message: open.message, prompt: open.prompt };
}
