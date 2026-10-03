import { NativeEventEmitter, Platform } from "react-native";
import { callBinary, nativeBytes } from "@legendapp/spark-desktop-app/src/contracts/native-buffer";
import { SparkError, invokeNative, asyncRegistration, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native from "./NativeDesktopFileSystem";
import { createFileHandle, iterateFile, writeFileChunks, type FileMode, type ReadChunksOptions } from "./handles";
export { FileCleanupError } from "./handles";
export type { FileHandle, FileMode, ReadChunksOptions } from "./handles";
export interface FileInfo { type: "file" | "directory" | "symlink"; size: number; modifiedAt: number }
export interface DirectoryEntry { name: string; path: string }
export interface CreateDirectoryOptions { recursive?: boolean }
export interface RemoveOptions { recursive?: boolean }
export interface CopyMoveOptions { overwrite?: boolean }
export interface WatchOptions { recursive?: boolean }
export interface OpenFileOptions { mode?: FileMode }
export interface WriteChunksOptions { mode?: "write" | "createNew"; signal?: AbortSignal }
export function getFileSystemAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getFileSystemAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "File IO requires a desktop host with NativeDesktopFileSystem installed");
  return Native!;
}
const absolute = (path: string) => nativePath(path, Platform.OS);
const isString = (value: unknown): value is string => typeof value === "string";
function validResponse(method: string, value: unknown): boolean {
  if (["directory", "openFile"].includes(method)) return isString(value) && value.length > 0;
  if (["readText"].includes(method)) return isString(value);
  if (method === "readBytes" || method === "readChunk") return value instanceof ArrayBuffer;
  if (method === "list") return Array.isArray(value) && value.every(name => isString(name) && name.length > 0 && ![".", ".."].includes(name) && !name.includes("/") && !name.includes("\0") && (Platform.OS !== "windows" || !name.includes("\\")));
  if (method === "stat") {
    if (!value || typeof value !== "object") return false;
    const info = value as FileInfo;
    return ["file", "directory", "symlink"].includes(info.type) && Number.isSafeInteger(info.size) && info.size >= 0 && typeof info.modifiedAt === "number" && Number.isFinite(info.modifiedAt);
  }
  if (method === "writeChunk") return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (method === "remove" || method === "writeTextIfUnchanged") return typeof value === "boolean";
  return value === null;
}
async function call<T = void>(method: string, args: object): Promise<T> {
  const { bytes, ...metadata } = args as { bytes?: Uint8Array };
  const value = await invokeNative(() => callBinary(native(), "__sparkFileSystemBinary", method, metadata, bytes));
  if (!validResponse(method, value)) throw new SparkError("E_INVALID_DATA", "Invalid native file response");
  return value as T;
}
/** Rejects unknown or extra option keys so a misspelled option can never silently no-op. */
function checkedOptions<T extends object>(options: T, allowed: readonly string[], label: string): T {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${label} options`);
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown ${label} option: ${key}`);
  return options;
}
function recursiveOption(options: { recursive?: boolean }, fallback: boolean): boolean {
  const value = checkedOptions(options, ["recursive"], "recursive");
  if (value.recursive !== undefined && typeof value.recursive !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "recursive must be a boolean");
  return value.recursive ?? fallback;
}
function overwriteOption(options: CopyMoveOptions): boolean {
  const value = checkedOptions(options, ["overwrite"], "copy/move");
  if (value.overwrite !== undefined && typeof value.overwrite !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "overwrite must be a boolean");
  return value.overwrite ?? false;
}
export async function getDirectory(kind: "data" | "cache" | "temp"): Promise<string> {
  if (!["data", "cache", "temp"].includes(kind)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid directory kind");
  const path = await call<string>("directory", { kind });
  try { return absolute(path); } catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid native directory path", { cause }); }
}
/** UTF-8. Invalid text rejects instead of inserting replacement characters. */
export async function readText(path: string): Promise<string> { return call("readText", { path: absolute(path) }); }
export async function writeText(path: string, text: string): Promise<void> {
  if (typeof text !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected a text string");
  await call("writeText", { path: absolute(path), text });
}
export async function readBytes(path: string): Promise<Uint8Array> { return nativeBytes(await call<ArrayBuffer>("readBytes", { path: absolute(path) })); }
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  if (!(bytes instanceof Uint8Array)) throw new SparkError("E_INVALID_ARGUMENT", "Expected Uint8Array");
  await call("writeBytes", { path: absolute(path), bytes });
}
/** Describes the link itself, without following it. modifiedAt is Unix milliseconds. */
export async function stat(path: string): Promise<FileInfo> { return call("stat", { path: absolute(path) }); }
export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if (error instanceof SparkError && error.code === "E_NOT_FOUND") return false;
    throw error;
  }
}
/** Entries are sorted by name. Metadata is obtained explicitly with stat(entry.path). */
export async function list(path: string): Promise<DirectoryEntry[]> {
  const directory = absolute(path);
  const names = await call<string[]>("list", { path: directory });
  const separator = Platform.OS === "windows" ? "\\" : "/";
  return names.sort().map(name => ({ name, path: directory.replace(/[\\/]+$/, "") + separator + name }));
}
export async function mkdir(path: string, options: CreateDirectoryOptions = {}): Promise<void> { await call("mkdir", { path: absolute(path), recursive: recursiveOption(options, true) }); }
/** Absence is success; deleting a nonempty directory requires recursive: true. */
export async function remove(path: string, options: RemoveOptions = {}): Promise<void> { await call("remove", { path: absolute(path), recursive: recursiveOption(options, false) }); }
/** Copies directories recursively and preserves symlinks. An existing destination rejects unless overwrite: true. Self-transfers and overlapping source/destination paths reject. Overwrite stages beside the destination and restores the previous destination if publication fails. If backup cleanup fails after commit, the native error reports the published destination and recoverable backup path. */
export async function copy(source: string, destination: string, options: CopyMoveOptions = {}): Promise<void> {
  await call("copy", { path: absolute(source), to: absolute(destination), overwrite: overwriteOption(options) });
}
/** An existing destination rejects unless overwrite: true. Self-transfers and overlapping source/destination paths reject. Cross-volume moves copy beside the destination before deleting the source. If source cleanup fails, the destination has been published, the source may be partially removed, and the previous destination is retained at a recovery path reported by the native error. Backup cleanup failures also report the committed destination and retained backup. */
export async function move(source: string, destination: string, options: CopyMoveOptions = {}): Promise<void> {
  await call("move", { path: absolute(source), to: absolute(destination), overwrite: overwriteOption(options) });
}
let nextWatch = 0;
/** Invalidation, not an exact change log. Recursive watches require a directory. */
export async function watch(path: string, listener: (path: string) => void, options: WatchOptions = {}): Promise<AsyncRegistration> {
  const location = absolute(path), recursive = recursiveOption(options, false);
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a watch listener");
  const id = `watch-${Date.now()}-${++nextWatch}`;
  let removed = false;
  const emitter = new NativeEventEmitter(native());
  const subscription = emitter.addListener("change", (event: { id: string; path: string }) => {
    if (!removed && event?.id === id && typeof event.path === "string") listener(event.path);
  });
  try { await call("watch", { path: location, id, recursive }); }
  catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { removed = true; subscription.remove(); }, async () => { await call("unwatch", { id }); });
}
/** read/readWrite require an existing regular file. write truncates; createNew rejects if it exists. */
export async function openFile(path: string, options: OpenFileOptions = {}) {
  checkedOptions(options, ["mode"], "openFile");
  return createFileHandle(call, absolute(path), options.mode);
}
/** Pull-based binary stream; closes on EOF, error, abort, or early loop exit. */
export function readChunks(path: string, options: ReadChunksOptions = {}): AsyncGenerator<Uint8Array> {
  checkedOptions(options, ["offset", "chunkSize", "signal"], "readChunks");
  return iterateFile(() => openFile(path), options);
}
/** Failure leaves a partial file; use a temporary file + move for publication. */
export async function writeChunks(path: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, options: WriteChunksOptions = {}): Promise<number> {
  checkedOptions(options, ["mode", "signal"], "writeChunks");
  if (options.mode !== undefined && options.mode !== "write" && options.mode !== "createNew") throw new SparkError("E_INVALID_ARGUMENT", "Streaming writes require write or createNew mode");
  return writeFileChunks(() => openFile(path, { mode: options.mode ?? "write" }), chunks, options.signal);
}
/** Move to the OS Trash/Recycle Bin. Never falls back to permanent deletion. */
export async function trash(path: string): Promise<void> { await call("trash", { path: absolute(path) }); }

/** Reveal an existing path in Finder or Explorer. */
export async function revealInFileManager(path: string): Promise<void> { await call("reveal", { path: absolute(path) }); }
/** Compare before replacing. Detects observed changes; not an OS-wide atomic compare-and-swap. */
export async function writeTextIfUnchanged(path: string, expected: string, contents: string): Promise<{ written: boolean }> {
  if (typeof expected !== "string" || typeof contents !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected text strings");
  return { written: await call<boolean>("writeTextIfUnchanged", { path: absolute(path), expected, text: contents }) };
}

export { scanFiles, getFileScanAvailability } from "./file-scanner";
export type { FileScanOptions, FileScanSkipEntry, ScannedFile, FileScanProgress, FileScanBatch, FileScanResult } from "./file-scanner";
