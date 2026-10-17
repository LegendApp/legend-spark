import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { absolute, call, featureAvailability, requireFeature } from "@legendapp/spark-file-system/src/native";

/** A saved version of a document. Read its contents with readDocumentVersionText. */
export interface DocumentVersion { id: string; name: string; modifiedAt: number }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isVersion = (value: unknown): value is DocumentVersion => record(value) && typeof value.id === "string" && !!value.id
  && typeof value.name === "string" && Number.isFinite(value.modifiedAt);
const isNull = (value: unknown) => value === null;

/** NSFileVersion on macOS. Windows: unsupported-platform (LegendApp/legend-spark#280). Volumes without a revision store (FAT, most network volumes) reject operations with E_UNAVAILABLE. */
export function getDocumentVersionsAvailability(): Availability { return featureAvailability("versions"); }
function versionsCall<T>(method: string, args: object, valid: (value: unknown) => boolean): Promise<T> {
  requireFeature("versions", "Document versions");
  return call<T>(method, args, valid);
}
/** Saved versions other than the current file, newest first. A missing file rejects with E_NOT_FOUND. */
export async function listDocumentVersions(path: string): Promise<DocumentVersion[]> {
  return versionsCall("versions", { path: absolute(path) }, value => Array.isArray(value) && value.every(isVersion));
}
/** Records the file's current contents as a version (a coordinated read). */
export async function addDocumentVersion(path: string): Promise<DocumentVersion> {
  return versionsCall("addVersion", { path: absolute(path) }, isVersion);
}
/**
 * The UTF-8 contents of a saved version, to preview it before restoring. Invalid text rejects (as readText does), an id of
 * no version of the file E_NOT_FOUND. Works in the App Sandbox: the version is looked up and read in one native call,
 * while it holds the sandbox's access to the revision store.
 */
export async function readDocumentVersionText(path: string, versionId: string): Promise<string> {
  if (typeof versionId !== "string" || !versionId) throw new SparkError("E_INVALID_ARGUMENT", "Expected a document version id");
  return versionsCall("readVersion", { path: absolute(path), id: versionId }, value => typeof value === "string");
}
/** Replaces the file with a version inside one coordinated write. The replaced contents are recorded as a version first, so a restore can be undone. */
export async function restoreDocumentVersion(path: string, versionId: string): Promise<void> {
  if (typeof versionId !== "string" || !versionId) throw new SparkError("E_INVALID_ARGUMENT", "Expected a document version id");
  await versionsCall("restoreVersion", { path: absolute(path), id: versionId }, isNull);
}

export interface DocumentFileState { locked: boolean; writable: boolean }
/** Internal to sessions: Finder lock and replaceability. Callers gate on session availability. */
export function documentFileState(path: string): Promise<DocumentFileState> {
  return call("documentState", { path: absolute(path) }, value => record(value) && typeof value.locked === "boolean" && typeof value.writable === "boolean");
}
export async function setDocumentFileLocked(path: string, locked: boolean): Promise<void> {
  await call("setLocked", { path: absolute(path), locked }, isNull);
}
