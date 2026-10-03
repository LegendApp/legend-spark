import { openFileDialog } from "@legendapp/spark-file-dialog";
export type { AsyncRegistration, Subscription } from "@legendapp/spark-desktop-app/src/contracts";
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

export function getLaunchDocumentPath({
  isDocumentPath,
  launchArguments,
}: GetLaunchDocumentPathOptions) {
  const argv = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
  return launchArguments?.find(isDocumentPath) ?? argv.find(isDocumentPath) ?? null;
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
