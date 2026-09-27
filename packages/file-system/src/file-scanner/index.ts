import { NativeEventEmitter, Platform } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native from "./NativeFileScanner";
export interface FileScanSkipEntry { relativePath: string; rootIndex: number }
export interface ScannedFile {
  path: string;
  name: string;
  extension: string;
  relativePath: string;
  rootIndex: number;
  modifiedAt?: number;
  size?: number;
  skipped: boolean;
}
export interface FileScanProgress { completedRoots: number; rootIndex: number; totalRoots: number }
export interface FileScanBatch extends FileScanProgress { files: ScannedFile[] }
export interface FileScanResult { totalFiles: number; totalRoots: number; errors: string[] }
export interface FileScanOptions {
  extensions?: readonly string[];
  batchSize?: number;
  includeHidden?: boolean;
  includeStats?: boolean;
  /** Marks known entries as skipped in emitted batches; it does not exclude their names. */
  skip?: readonly FileScanSkipEntry[];
  onBatch?: (event: FileScanBatch) => void;
  onProgress?: (event: FileScanProgress) => void;
  /** Cancellation is cooperative between filesystem operations; the promise waits for native work to stop. */
  signal?: AbortSignal;
}
export function getFileScanAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function progress(value: unknown, roots: number): FileScanProgress {
  if (!record(value) || !count(value.rootIndex) || value.rootIndex >= roots || !count(value.completedRoots) || value.completedRoots > roots || value.totalRoots !== roots) throw new SparkError("E_INVALID_DATA", "Invalid scan progress");
  return { rootIndex: value.rootIndex, completedRoots: value.completedRoots, totalRoots: value.totalRoots };
}
function scannedFile(value: unknown, roots: number): ScannedFile {
  if (!record(value) || !count(value.rootIndex) || value.rootIndex >= roots || typeof value.absolutePath !== "string" || !value.absolutePath.startsWith("/") || typeof value.fileName !== "string" || typeof value.relativePath !== "string" || typeof value.extension !== "string" || (value.size !== undefined && !count(value.size)) || (value.modifiedTime !== undefined && (typeof value.modifiedTime !== "number" || !Number.isFinite(value.modifiedTime))) || (value.skipped !== undefined && typeof value.skipped !== "boolean")) throw new SparkError("E_INVALID_DATA", "Invalid scanned file");
  return { path: value.absolutePath, name: value.fileName, extension: value.extension, relativePath: value.relativePath, rootIndex: value.rootIndex, size: value.size, modifiedAt: value.modifiedTime, skipped: value.skipped ?? false };
}
let nextScan = 0;
export async function scanFiles(paths: readonly string[], options: FileScanOptions = {}): Promise<FileScanResult> {
  if (!Array.isArray(paths)) throw new SparkError("E_INVALID_ARGUMENT", "Expected scan paths");
  const roots = Array.from(paths, path => nativePath(path, Platform.OS));
  if (!options || typeof options !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected scan options");
  for (const key of Object.keys(options)) if (!["extensions", "batchSize", "includeHidden", "includeStats", "skip", "onBatch", "onProgress", "signal"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported scan option: ${key}`);
  if (options.batchSize !== undefined && (!count(options.batchSize) || options.batchSize < 1 || options.batchSize > 10000)) throw new SparkError("E_INVALID_ARGUMENT", "batchSize must be between 1 and 10000");
  for (const value of [options.includeHidden, options.includeStats]) if (value !== undefined && typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Scan flags must be boolean");
  for (const value of [options.onBatch, options.onProgress]) if (value !== undefined && typeof value !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Scan callbacks must be functions");
  if (options.extensions !== undefined && (!Array.isArray(options.extensions) || options.extensions.some(value => typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(value)))) throw new SparkError("E_INVALID_ARGUMENT", "Expected file extensions without dots or wildcards");
  if (options.skip !== undefined && (!Array.isArray(options.skip) || options.skip.some(value => !value || !count(value.rootIndex) || value.rootIndex >= roots.length || typeof value.relativePath !== "string" || !value.relativePath || value.relativePath.startsWith("/") || value.relativePath.split("/").includes("..")))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid skipped file entry");
  const availability = getFileScanAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "File scanning requires a macOS host with NativeFileScanner installed");
  const { signal, onBatch, onProgress, extensions, ...nativeOptions } = options;
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AbortSignal");
  const aborted = () => new SparkError("E_ABORTED", "File scan aborted", { cause: signal?.reason });
  if (signal?.aborted) throw aborted();
  const id = `scan-${Date.now()}-${++nextScan}`;
  const subscriptions: Subscription[] = [];
  let callbackError: unknown;
  let callbackFailed = false;
  let cancellation: Promise<void> | undefined;
  const cancel = () => { cancellation ??= invokeNative(() => Native!.cancelScan(id)); void cancellation.catch(() => undefined); };
  const deliver = (value: unknown, callback: (value: Record<string, unknown>) => void) => {
    if (!record(value) || value.id !== id || signal?.aborted || callbackFailed) return;
    try { callback(value); } catch (error) { callbackFailed = true; callbackError = error; cancel(); }
  };
  try {
    const emitter = new NativeEventEmitter(Native!);
    if (onProgress) subscriptions.push(emitter.addListener("onFileScanProgress", value => deliver(value, event => onProgress?.(progress(event, roots.length)))));
    if (onBatch) subscriptions.push(emitter.addListener("onFileScanBatch", value => deliver(value, event => {
      const snapshot = progress(event, roots.length);
      if (!Array.isArray(event.files)) throw new SparkError("E_INVALID_DATA", "Invalid scan batch");
      const files = event.files.map((file: unknown) => scannedFile(file, roots.length));
      onBatch?.({ ...snapshot, files });
    })));
    signal?.addEventListener("abort", cancel, { once: true });
    let json: string;
    try { json = await invokeNative(() => Native!.scanFiles(id, JSON.stringify(roots), JSON.stringify({ ...nativeOptions, allowedExtensions: extensions }))); }
    catch (error) { if (callbackFailed) throw callbackError; if (signal?.aborted) throw aborted(); throw error; }
    if (callbackFailed) throw callbackError;
    if (signal?.aborted) throw aborted();
    return parseNativeResult(json, (value): value is FileScanResult => !!value && typeof value === "object" && "totalFiles" in value && count(value.totalFiles) && "totalRoots" in value && value.totalRoots === roots.length && "errors" in value && Array.isArray(value.errors) && value.errors.every(error => typeof error === "string"));
  } finally {
    signal?.removeEventListener("abort", cancel);
    subscriptions.forEach(subscription => subscription.remove());
    if (cancellation) await cancellation;
  }
}
