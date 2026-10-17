import { openFileDialog } from "@legendapp/spark-file-dialog";
export type { AsyncRegistration, Subscription } from "@legendapp/spark-desktop-app/src/contracts";
export * from "./requests";
export { createDocumentTransitionGuard } from "./documentTransition";
export * from "./controller";
export * from "./reload";
export { createDocumentSession, findDocumentSession, getDocumentSessionAvailability, type DocumentSession, type DocumentSessionOptions, type DocumentState, type DocumentSaveOptions, type DocumentSaveResult } from "./session";
export { getDocumentVersionsAvailability, listDocumentVersions, addDocumentVersion, readDocumentVersionText, restoreDocumentVersion, type DocumentVersion } from "./versions";
export * from "./hooks";

/** Options for `openSelectedDocumentPath`. `allowedFileTypes` are extensions without the dot; `invalidSelectionMessage` replaces the default error text when no selected path passes `isDocumentPath`. */
export interface OpenSelectedDocumentPathOptions {
  allowedFileTypes: readonly string[];
  invalidSelectionMessage?: string;
  isDocumentPath: (path: string) => boolean;
}
/** Options for `getLaunchDocumentPath`. */
export interface GetLaunchDocumentPathOptions {
  isDocumentPath: (path: string) => boolean;
  launchArguments?: string[];
}

/** First path in `launchArguments`, then in `process.argv`, that passes `isDocumentPath`, or null. */
export function getLaunchDocumentPath({
  isDocumentPath,
  launchArguments,
}: GetLaunchDocumentPathOptions) {
  const argv = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
  return launchArguments?.find(isDocumentPath) ?? argv.find(isDocumentPath) ?? null;
}

/** Shows the open panel filtered to `allowedFileTypes` and resolves the first selected path that passes `isDocumentPath`, or null when canceled. Throws an `Error` when files were selected but none qualify. */
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
