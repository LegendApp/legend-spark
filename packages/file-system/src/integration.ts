import { Platform } from "react-native";
import { nativeBytes } from "@legendapp/spark-desktop-app/src/contracts/native-buffer";
import { SparkError, asyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { absolute, call, checkedOptions, featureAvailability, requireFeature, booleanOption, type FileFeature } from "./native";
import { FileCleanupError } from "./handles";

const isString = (value: unknown): value is string => typeof value === "string";
const isNull = (value: unknown) => value === null;
const isBuffer = (value: unknown) => value instanceof ArrayBuffer;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Feature gate, then a validated native call. */
async function featureCall<T>(feature: FileFeature, label: string, method: string, args: object, valid: (value: unknown) => boolean): Promise<T> {
  requireFeature(feature, label);
  return call<T>(method, args, valid);
}

// Security-scoped bookmarks

export interface CreateBookmarkOptions { readOnly?: boolean }
/**
 * An open security-scoped access. It lasts until close() resolves; the only other end is JS runtime
 * teardown (reload or quit). close() is idempotent, concurrent calls share completion, and a failed
 * close can be retried. Unbalanced accesses leak sandbox kernel resources until relaunch.
 */
export interface BookmarkAccess { path: string; stale: boolean; close(): Promise<void> }
/** macOS security-scoped bookmarks. Windows desktop apps have no per-item file sandbox to persist, so bookmarks are unsupported there. Sandboxed apps also need the com.apple.security.files.bookmarks.app-scope entitlement; without it operations reject with E_UNAVAILABLE. */
export function getBookmarkAvailability(): Availability { return featureAvailability("bookmarks"); }
/** Returns opaque bookmark bytes to persist (for example with writeBytes). They remain valid across launches and track moves/renames. */
export async function createBookmark(path: string, options: CreateBookmarkOptions = {}): Promise<Uint8Array> {
  const readOnly = booleanOption(checkedOptions(options, ["readOnly"], "createBookmark").readOnly, "readOnly", false);
  return nativeBytes(await featureCall<ArrayBuffer>("bookmarks", "Security-scoped bookmarks", "createBookmark", { path: absolute(path), readOnly }, value => isBuffer(value) && value.byteLength > 0));
}
/** Resolves a bookmark and starts security-scoped access. stale: true means recreate the bookmark from path while access is open. Malformed data rejects with E_INVALID_DATA; a deleted target with E_NOT_FOUND. */
export async function accessBookmark(bookmark: Uint8Array): Promise<BookmarkAccess> {
  if (!(bookmark instanceof Uint8Array) || !bookmark.byteLength) throw new SparkError("E_INVALID_ARGUMENT", "Expected bookmark bytes");
  const result = await featureCall<{ id: string; path: string; stale: boolean }>("bookmarks", "Security-scoped bookmarks", "accessBookmark", { bytes: bookmark },
    value => record(value) && isString(value.id) && !!value.id && isString(value.path) && value.path.startsWith("/") && typeof value.stale === "boolean");
  const access = asyncRegistration(() => {}, () => call("closeBookmark", { id: result.id }, isNull));
  return { path: result.path, stale: result.stale, close: () => access.remove() };
}
/** Opens access for the duration of callback and closes it when the callback settles. If both fail, rejects with FileCleanupError carrying both errors. */
export async function withBookmarkAccess<T>(bookmark: Uint8Array, callback: (access: BookmarkAccess) => T | Promise<T>): Promise<T> {
  if (typeof callback !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a callback");
  const access = await accessBookmark(bookmark);
  let result: T, failed = false, failure: unknown;
  try { result = await callback(access); } catch (error) { failed = true; failure = error; }
  try { await access.close(); }
  catch (cleanupError) { throw new FileCleanupError(failed, failure, cleanupError, access.close); }
  if (failed) throw failure;
  return result!;
}

// Full Disk Access

/** indeterminate: the app is sandboxed, and the sandbox denies the probed files the same way TCC does. */
export type FullDiskAccessStatus = "granted" | "denied" | "indeterminate";
/** macOS only; Windows has no Full Disk Access privacy gate. */
export function getFullDiskAccessAvailability(): Availability { return featureAvailability("fullDiskAccess"); }
/** Probes TCC-protected files. macOS attributes access to the responsible process: an app launched from a terminal inherits that terminal's grant. */
export async function getFullDiskAccessStatus(): Promise<FullDiskAccessStatus> {
  return featureCall("fullDiskAccess", "Full Disk Access", "fullDiskAccess", {}, value => value === "granted" || value === "denied" || value === "indeterminate");
}
/** Opens System Settings › Privacy & Security › Full Disk Access. Granting requires the user. */
export async function openFullDiskAccessSettings(): Promise<void> {
  await featureCall("fullDiskAccess", "Full Disk Access", "openFullDiskAccessSettings", {}, isNull);
}

// Open with

export interface FileApplication { name: string; path: string; isDefault: boolean }
export function getOpenWithAvailability(): Availability { return featureAvailability("openWith"); }
/** Applications registered to open the file, without duplicates. At most one isDefault. */
export async function getApplicationsForFile(path: string): Promise<FileApplication[]> {
  return featureCall("openWith", "Open with", "applications", { path: absolute(path) }, value => Array.isArray(value)
    && value.every(app => record(app) && isString(app.name) && isString(app.path) && !!app.path && typeof app.isDefault === "boolean")
    && value.filter(app => app.isDefault).length <= 1);
}
/** Opens the file with the application at an absolute path (macOS .app bundle; Windows: a path from getApplicationsForFile). */
export async function openWithApplication(path: string, application: string): Promise<void> {
  if (!isString(application) || !application) throw new SparkError("E_INVALID_ARGUMENT", "Expected an application path");
  await featureCall("openWith", "Open with", "openWith", { path: absolute(path), application: absolute(application) }, isNull);
}

// Icons, thumbnails and Quick Look

/** size is the PNG's pixel width and height, an integer from 1 to 1024. */
export interface FileImageOptions { size: number }
function imageSize(options: FileImageOptions, label: string) {
  const { size } = checkedOptions(options, ["size"], label);
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new SparkError("E_INVALID_ARGUMENT", "size must be an integer from 1 to 1024");
  return size;
}
const png = (value: unknown) => isBuffer(value) && value.byteLength > 8 && new Uint8Array(value, 0, 4).join() === "137,80,78,71";
export function getFileIconAvailability(): Availability { return featureAvailability("fileIcons"); }
export function getThumbnailAvailability(): Availability { return featureAvailability("thumbnails"); }
export function getQuickLookAvailability(): Availability { return featureAvailability("quickLook"); }
/** The system icon for an existing file, as size×size PNG bytes (macOS NSWorkspace; Windows IShellItemImageFactory). */
export async function getFileIcon(path: string, options: FileImageOptions): Promise<Uint8Array> {
  return nativeBytes(await featureCall<ArrayBuffer>("fileIcons", "File icons", "icon", { path: absolute(path), size: imageSize(options, "getFileIcon") }, png));
}
/** A content thumbnail as PNG bytes, fitted within size. Rejects with E_UNAVAILABLE when the file has no thumbnail; it never substitutes the icon. */
export async function getThumbnail(path: string, options: FileImageOptions): Promise<Uint8Array> {
  return nativeBytes(await featureCall<ArrayBuffer>("thumbnails", "Thumbnails", "thumbnail", { path: absolute(path), size: imageSize(options, "getThumbnail") }, png));
}
/** Shows the Quick Look panel for existing items. Resolves once the panel is shown; the user dismisses it. */
export async function showQuickLook(paths: readonly string[]): Promise<void> {
  if (!Array.isArray(paths) || !paths.length) throw new SparkError("E_INVALID_ARGUMENT", "Expected at least one path");
  await featureCall("quickLook", "Quick Look", "quickLook", { paths: paths.map(absolute) }, isNull);
}

// Extended attributes and quarantine

function attributeName(name: string) {
  if (!isString(name) || !name || name.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an extended attribute name");
  return name;
}
/** macOS extended attributes. Windows alternate data streams have different semantics and are not exposed here. Operations follow symlinks. */
export function getExtendedAttributeAvailability(): Availability { return featureAvailability("extendedAttributes"); }
/** Attribute names, sorted. */
export async function listExtendedAttributes(path: string): Promise<string[]> {
  return featureCall("extendedAttributes", "Extended attributes", "listXattrs", { path: absolute(path) }, value => Array.isArray(value) && value.every(isString));
}
/** null when the attribute is absent; a missing file rejects with E_NOT_FOUND. */
export async function getExtendedAttribute(path: string, name: string): Promise<Uint8Array | null> {
  const value = await featureCall<ArrayBuffer | null>("extendedAttributes", "Extended attributes", "getXattr", { path: absolute(path), name: attributeName(name) }, value => value === null || isBuffer(value));
  return value === null ? null : nativeBytes(value);
}
export async function setExtendedAttribute(path: string, name: string, value: Uint8Array): Promise<void> {
  if (!(value instanceof Uint8Array)) throw new SparkError("E_INVALID_ARGUMENT", "Expected Uint8Array");
  await featureCall("extendedAttributes", "Extended attributes", "setXattr", { path: absolute(path), name: attributeName(name), bytes: value }, isNull);
}
/** Absence of the attribute is success; a missing file rejects with E_NOT_FOUND. */
export async function removeExtendedAttribute(path: string, name: string): Promise<void> {
  await featureCall("extendedAttributes", "Extended attributes", "removeXattr", { path: absolute(path), name: attributeName(name) }, isNull);
}

/**
 * macOS com.apple.quarantine / Windows Mark of the Web (Zone.Identifier). timestamp is Unix ms.
 * macOS records agentName and timestamp; LaunchServices accepts origin/data URLs but stores neither
 * (tests/file-integration.native.mm checks this), so setQuarantine rejects them. getQuarantine still
 * reports URLs an OS recorded. Windows records originURL (ReferrerUrl) and dataURL (HostUrl).
 */
export interface QuarantineInfo { agentName?: string; originURL?: string; dataURL?: string; timestamp?: number }
export function getQuarantineAvailability(): Availability { return featureAvailability("quarantine"); }
const quarantineKeys = ["agentName", "originURL", "dataURL", "timestamp"] as const;
function validQuarantine(value: unknown): value is QuarantineInfo {
  return record(value) && Object.keys(value).every(key => (quarantineKeys as readonly string[]).includes(key))
    && ["agentName", "originURL", "dataURL"].every(key => value[key] === undefined || isString(value[key]))
    && (value.timestamp === undefined || (typeof value.timestamp === "number" && Number.isFinite(value.timestamp)));
}
/** null when the item is not quarantined. */
export async function getQuarantine(path: string): Promise<QuarantineInfo | null> {
  return featureCall("quarantine", "Quarantine", "getQuarantine", { path: absolute(path) }, value => value === null || validQuarantine(value));
}
/** Marks an existing item as downloaded. Fields the platform does not record reject with E_UNSUPPORTED_OPTION instead of being dropped. */
export async function setQuarantine(path: string, info: QuarantineInfo = {}): Promise<void> {
  checkedOptions(info, quarantineKeys, "quarantine");
  if (!validQuarantine(info)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid quarantine information");
  for (const key of ["originURL", "dataURL"] as const) if (info[key] !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(info[key]!)) throw new SparkError("E_INVALID_ARGUMENT", `${key} must be an absolute URL`);
  requireFeature("quarantine", "Quarantine");
  if (Platform.OS === "windows" && (info.agentName !== undefined || info.timestamp !== undefined)) throw new SparkError("E_UNSUPPORTED_OPTION", "Windows Mark of the Web records no agentName or timestamp");
  if (Platform.OS === "macos" && (info.originURL !== undefined || info.dataURL !== undefined)) throw new SparkError("E_UNSUPPORTED_OPTION", "macOS LaunchServices discards quarantine download URLs");
  await call("setQuarantine", { path: absolute(path), info }, isNull);
}
/** Removes the quarantine marker. An unquarantined item is success; a missing file rejects with E_NOT_FOUND. */
export async function clearQuarantine(path: string): Promise<void> {
  await featureCall("quarantine", "Quarantine", "clearQuarantine", { path: absolute(path) }, isNull);
}

// Disk space

/** availableBytes is space available to this user now. macOS importantUsageBytes adds purgeable space the system can free for user-initiated work. */
export interface DiskSpace { totalBytes: number; availableBytes: number; macos?: { importantUsageBytes: number } }
export function getDiskSpaceAvailability(): Availability { return featureAvailability("diskSpace"); }
/** Capacity of the volume containing an existing path. */
export async function getDiskSpace(path: string): Promise<DiskSpace> {
  return featureCall("diskSpace", "Disk space", "diskSpace", { path: absolute(path) }, value => record(value) && isCount(value.totalBytes) && isCount(value.availableBytes)
    && (value.macos === undefined || (record(value.macos) && isCount(value.macos.importantUsageBytes)))
    && Object.keys(value).every(key => ["totalBytes", "availableBytes", "macos"].includes(key)));
}
