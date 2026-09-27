import { openFileDialog } from "@legendapp/spark-file-dialog";
export * from "./requests";
export { createDocumentTransitionGuard } from "./documentTransition";
export * from "./controller";
export * from "./reload";
export * from "./hooks";

export interface OpenSelectedDocumentPathOptions {
  allowedFileTypes: readonly string[];
  invalidSelectionMessage?: string;
  isDocumentPath: (path: string) => boolean;
}
export interface GetLaunchDocumentPathOptions {
  isDocumentPath: (path: string) => boolean;
  launchArguments?: string[];
}

export function getPathExtension(path: string) {
  return path.split(".").pop()?.toLowerCase();
}

export function pathMatchesExtensions(path: string, extensions: readonly string[]) {
  const extension = getPathExtension(path);
  return extension !== undefined && extensions.includes(extension);
}

export function getLaunchDocumentPath({
  isDocumentPath,
  launchArguments,
}: GetLaunchDocumentPathOptions) {
  const argv = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
  return launchArguments?.find(isDocumentPath) ?? argv.find(isDocumentPath) ?? null;
}

export function getDirectory(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : undefined;
}

export function getFilename(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export async function openSelectedDocumentPath({
  allowedFileTypes,
  invalidSelectionMessage,
  isDocumentPath,
}: OpenSelectedDocumentPathOptions) {
  const result = await openFileDialog({
    filters: [{ extensions: allowedFileTypes }],
    selection: "files",
  });
  const paths = result.canceled ? [] : result.paths;
  const path = paths.find(isDocumentPath) ?? null;

  if (path) {
    return path;
  }

  if (paths && paths.length > 0) {
    throw new Error(
      invalidSelectionMessage ?? `Choose a supported file (${allowedFileTypes.map((type) => `.${type}`).join(", ")}).`,
    );
  }

  return null;
}
