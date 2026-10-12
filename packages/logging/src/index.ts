import { Platform } from "react-native";
import { SparkError, invokeNative, nativeError, parseNativeResult, type Availability, type SparkErrorCode, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native, { type Spec } from "./NativeDesktopLogging";

/** Unified log levels, least to most severe. `notice` is os_log's default level. */
export type LogLevel = "debug" | "info" | "notice" | "error" | "fault";
/**
 * Structured data for an entry, written as JSON: in the unified log as a private value, in log files
 * (and so in diagnostics exports) in full. Values JSON cannot hold are marked rather than thrown:
 * an Error becomes { name, message }, a BigInt "<digits>n", an object inside itself "[Circular]";
 * a throwing toJSON makes the fields { unserializable: <its message> }.
 */
export type LogFields = { readonly [key: string]: unknown };
export interface LoggerOptions {
  /**
   * Shows messages in the unified log as written. Default false: the system stores them as
   * `<private>` unless the app is being debugged, as Apple advises for dynamic strings. Log files
   * always hold messages in full.
   */
  publicMessages?: boolean;
}
/** Writes entries for one category. Each call returns at once; entries reach native in call order. */
export interface Logger {
  readonly category: string;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  notice(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fault(message: string, fields?: LogFields): void;
}
export interface LogFileOptions {
  /** Absolute folder for app.log and its rotated files. Default: ~/Library/Logs/<bundle identifier>. */
  directory?: string;
  /** A file rotates before an entry would take it past this size. 4,096 to 1,073,741,824. Default 1 MiB. */
  maxFileBytes?: number;
  /** app.log plus up to maxFiles - 1 rotated files (app.1.log is the newest). 1 to 100. Default 5. */
  maxFiles?: number;
}
export interface LoggingOptions {
  /** The least severe level written. Default "info". */
  level?: LogLevel;
  /** Merges into the current file settings, or the defaults while files are off; `null` stops writing files. Files are on by default. */
  files?: LogFileOptions | null;
}
export interface LogFile { path: string; bytes: number; /** Unix time in milliseconds. */ modifiedAt: number }
export interface ExportDiagnosticsOptions {
  /** App details to include in diagnostics.json as `info`, such as the open document's type or a feature flag. */
  info?: LogFields;
}
/**
 * Entries that did not reach the log file. `dropped` counts them: on the first failure it is 1 (or the
 * entries dropped at once); when writing works again (`recovered: true`) it is the total since the last flush.
 */
export interface LoggingErrorEvent { code: SparkErrorCode; message: string; dropped: number; recovered: boolean }
/** Rejected by flushLogs: the first failure since the last flush, with the number of entries not written. */
export class LogWriteError extends SparkError {
  readonly dropped: number;
  constructor(code: SparkErrorCode, message: string, dropped: number, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "LogWriteError";
    this.dropped = dropped;
  }
}
export interface DiagnosticsExport {
  path: string;
  bytes: number;
  /** Files in the archive, under its Diagnostics folder: diagnostics.json, then logs/app.log and the rotated files. */
  entries: string[];
}
/** Parts of logging, for `getLoggingAvailability(feature)`. */
export type LoggingFeature = "systemLog" | "files" | "diagnostics";
const FEATURES: readonly LoggingFeature[] = ["systemLog", "files", "diagnostics"];
const NAMES: Record<LoggingFeature, string> = { systemLog: "Logging", files: "Log files", diagnostics: "Diagnostics export" };
const LEVELS: readonly LogLevel[] = ["debug", "info", "notice", "error", "fault"];

/** Without a feature, reports logging as a whole. macOS only; Windows (ETW) is tracked in #319. */
export function getLoggingAvailability(feature?: LoggingFeature): Availability {
  if (feature !== undefined && !FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown logging feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(feature: LoggingFeature): Spec {
  const availability = getLoggingAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${NAMES[feature]} requires macOS with NativeDesktopLogging installed`);
  return Native!;
}

const invalid = (message: string, cause?: unknown): never => { throw new SparkError("E_INVALID_ARGUMENT", message, cause === undefined ? undefined : { cause }); };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function knownKeys(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`Expected ${what}`);
  for (const key of Object.keys(value as object)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${what} key: ${key}`);
  return value as Record<string, unknown>;
}
/** JSON for log fields. Never throws on content: what JSON cannot hold is marked; a throwing toJSON replaces the fields with { unserializable }. */
function encodeFields(fields: unknown, what: string) {
  if (!isRecord(fields)) invalid(`${what} must be an object`);
  const ancestors: unknown[] = [];
  try {
    return JSON.stringify(fields, function (this: unknown, _key, value: unknown) {
      if (typeof value === "bigint") return `${value}n`;
      if (value instanceof Error) value = { name: value.name, message: value.message };
      if (typeof value !== "object" || value === null) return value;
      while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(value)) return "[Circular]";
      ancestors.push(value);
      return value;
    });
  } catch (cause) {
    return JSON.stringify({ unserializable: cause instanceof Error ? cause.message : String(cause) });
  }
}
const integer = (value: unknown, min: number, max: number, what: string) => {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) invalid(`${what} is an integer from ${min} to ${max}`);
  return value as number | undefined;
};

/** Entries below this rank never cross to native. */
let minimum = LEVELS.indexOf("info");

/**
 * A logger for one category (an os_log category under the app's bundle identifier). Entries go to
 * the unified log, where Console and `log stream` show them, and to rotating JSON-lines files.
 */
export function createLogger(category: string, options: LoggerOptions = {}): Logger {
  if (typeof category !== "string" || !category || category.length > 100 || category.includes("\0")) invalid("category is 1 to 100 characters without NUL");
  knownKeys(options, ["publicMessages"], "logger options");
  if (options.publicMessages !== undefined && typeof options.publicMessages !== "boolean") invalid("publicMessages is a boolean");
  const publicMessages = options.publicMessages === true;
  const native = requireAvailable("systemLog");
  const writer = (level: LogLevel) => {
    const rank = LEVELS.indexOf(level);
    return (message: string, fields?: LogFields) => {
      if (typeof message !== "string") invalid("A log message is a string");
      if (rank < minimum) return;
      native.log(Date.now(), level, category, message, fields === undefined ? "" : encodeFields(fields, "Log fields"), publicMessages);
    };
  };
  return { category, debug: writer("debug"), info: writer("info"), notice: writer("notice"), error: writer("error"), fault: writer("fault") };
}

async function call<T>(native: Spec, method: string, args: string, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native.call(method, args)), validate);
}
const isNull = (value: unknown): value is null => value === null;

/**
 * Changes the level and the log files. Entries logged before this call use the previous settings;
 * entries after it use the new ones. Opens the log file before resolving, so a folder that cannot
 * be written rejects here.
 */
export async function configureLogging(options: LoggingOptions): Promise<void> {
  knownKeys(options, ["level", "files"], "logging options");
  const { level, files } = options;
  if (level !== undefined && !LEVELS.includes(level)) invalid("level is debug, info, notice, error or fault");
  let wireFiles: LogFileOptions | null | undefined = files === null ? null : undefined;
  if (files !== undefined && files !== null) {
    knownKeys(files, ["directory", "maxFileBytes", "maxFiles"], "log file options");
    wireFiles = {
      directory: files.directory === undefined ? undefined : nativePath(files.directory, Platform.OS),
      maxFileBytes: integer(files.maxFileBytes, 4096, 1024 ** 3, "maxFileBytes"),
      maxFiles: integer(files.maxFiles, 1, 100, "maxFiles"),
    };
  }
  const native = requireAvailable("files");
  // Entries logged after this call use the new level at once; a rejected configuration restores the old one.
  const previous = minimum;
  if (level !== undefined) minimum = LEVELS.indexOf(level);
  try { await call(native, "configure", JSON.stringify({ level, files: wireFiles }), isNull); }
  catch (error) {
    minimum = previous;
    throw error;
  }
}

/**
 * Resolves once every earlier entry is written. Rejects with a LogWriteError for the first failure since
 * the last flush, counting the entries that did not reach the file.
 */
export async function flushLogs(): Promise<void> {
  const native = requireAvailable("files");
  try { await native.call("flush", "{}"); }
  catch (cause) {
    const error = nativeError(cause);
    const dropped = (cause as { userInfo?: { dropped?: unknown } } | null)?.userInfo?.dropped;
    throw new LogWriteError(error.code, error.message, typeof dropped === "number" ? dropped : 0, { cause });
  }
}

/**
 * Called when entries stop reaching the log file (a full disk, a read-only folder, more than 10,000
 * entries waiting) and again when writing works. The failure is also logged once to the unified log.
 */
export function addLoggingErrorListener(listener: (event: LoggingErrorEvent) => void): Subscription {
  if (typeof listener !== "function") invalid("listener must be a function");
  requireAvailable("files");
  return onDesktopEvent(event => {
    const { code, message, dropped, recovered } = event;
    if (typeof code !== "string" || typeof message !== "string" || typeof dropped !== "number") return;
    listener({ code: nativeError({ code }).code, message, dropped, recovered: recovered === true });
  }, { types: ["loggingError"] });
}

const isLogFile = (value: unknown): value is LogFile => isRecord(value) && typeof value.path === "string" && Number.isInteger(value.bytes) && (value.bytes as number) >= 0 && typeof value.modifiedAt === "number";
/** The current file and its rotated predecessors, newest first, after earlier entries are written. Empty when files are off. */
export async function getLogFiles(): Promise<LogFile[]> {
  return call(requireAvailable("files"), "files", "{}", (value): value is LogFile[] => Array.isArray(value) && value.every(isLogFile));
}

/**
 * Writes a zip of diagnostics.json (app, macOS and logging details, plus `info`) and the log files
 * to `path`, replacing a file there. It stays on this Mac: nothing is uploaded or sent. Show the
 * user a save panel, or write it somewhere they can attach it to a report themselves.
 */
export async function exportDiagnostics(path: string, options: ExportDiagnosticsOptions = {}): Promise<DiagnosticsExport> {
  knownKeys(options, ["info"], "diagnostics options");
  const target = nativePath(path, Platform.OS);
  const args = `{"path":${JSON.stringify(target)}${options.info === undefined ? "" : `,"info":${encodeFields(options.info, "Diagnostics info")}`}}`;
  return call(requireAvailable("diagnostics"), "exportDiagnostics", args, (value): value is DiagnosticsExport =>
    isRecord(value) && value.path === target && Number.isInteger(value.bytes) && (value.bytes as number) > 0
    && Array.isArray(value.entries) && value.entries[0] === "diagnostics.json" && value.entries.every(entry => typeof entry === "string"));
}
