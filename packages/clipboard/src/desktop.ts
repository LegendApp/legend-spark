import { Platform } from "react-native";
import { callBinary, nativeBytes } from "@legendapp/spark-desktop-app/src/contracts/native-buffer";
import { SparkError, asyncRegistration, nativeError, parseNativeResult, invokeNative, type AsyncRegistration, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopClipboard";
import { RICH_CLIPBOARD_FEATURES, integerOption, knownOptions, stringOptions } from "./options";
import type {
  ClipboardChangeEvent, ClipboardChangeOptions, ClipboardContent, ClipboardData, ClipboardDataType, ClipboardWriteContent, ClipboardWriteOptions, GetStringOptions,
  PromisedClipboardContent, PromisedClipboardOptions, RichClipboardFeature, SetStringOptions,
} from "./types";
export { StringFormat } from "./formats";
export type {
  ClipboardChangeEvent, ClipboardChangeOptions, ClipboardContent, ClipboardData, ClipboardDataType, ClipboardWriteContent, ClipboardWriteOptions, ClipboardImage, GetStringOptions,
  PromisedClipboardContent, PromisedClipboardOptions, RichClipboardFeature, SetStringOptions,
} from "./types";
// Features this module implements beyond the base rich clipboard, by platform (Windows: #359).
const FEATURE_PLATFORMS: Record<RichClipboardFeature, readonly string[]> = { promisedData: ["macos"], changeEvents: ["macos"], privacyMarkers: ["macos"] };
/** The rich clipboard module, or one of its features, on this platform. */
export function getRichClipboardAvailability(feature?: RichClipboardFeature): Availability {
  if (feature !== undefined && !RICH_CLIPBOARD_FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown clipboard feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (feature && !FEATURE_PLATFORMS[feature].includes(Platform.OS)) return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native(feature?: RichClipboardFeature) {
  const availability = getRichClipboardAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE",
    feature ? `Clipboard ${feature} is unavailable on this platform` : "Desktop clipboard module is unavailable");
  return Native!;
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T, feature?: RichClipboardFeature): Promise<T> {
  return parseNativeResult(await invokeNative(() => native(feature).call(method, JSON.stringify(args))), validate);
}
const isVoid = (value: unknown): value is null => value === null;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isCount = (value: unknown): value is number => Number.isSafeInteger(value);
let sequence = 0;
const token = (kind: string) => `clipboard-${kind}-${Date.now()}-${++sequence}`;
/** Expo-compatible text/HTML subset. */
export async function getStringAsync(options: GetStringOptions = {}): Promise<string> {
  return call("getString", { format: stringOptions(options, "preferredFormat") }, (value): value is string => typeof value === "string");
}
export async function setStringAsync(text: string, options: SetStringOptions = {}): Promise<boolean> {
  if (typeof text !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Clipboard text must be a string");
  return call("setString", { text, format: stringOptions(options, "inputFormat") }, isBoolean);
}
export async function hasStringAsync(): Promise<boolean> { return call("hasString", {}, (value): value is boolean => typeof value === "boolean"); }
export async function readClipboard(): Promise<ClipboardContent> {
  const raw = await invokeNative(() => callBinary(native(), "__sparkClipboardBinary", "read", {})) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SparkError("E_INVALID_DATA", "Invalid clipboard content");
  const result: ClipboardContent = {};
  for (const key of ["text", "html", "rtf"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") throw new SparkError("E_INVALID_DATA", `Invalid clipboard ${key}`);
    if (typeof raw[key] === "string") result[key] = raw[key];
  }
  if (raw.files !== undefined) {
    if (!Array.isArray(raw.files) || raw.files.some(value => typeof value !== "string")) throw new SparkError("E_INVALID_DATA", "Invalid clipboard files");
    try { result.files = raw.files.map(value => nativePath(value, Platform.OS)); }
    catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid clipboard file paths", { cause }); }
  }
  if (raw.imagePNG !== undefined) {
    result.image = { format: "png", bytes: nativeBytes(raw.imagePNG) };
  }
  return result;
}
export async function getClipboardFormats(): Promise<string[]> { return call("formats", {}, (value): value is string[] => Array.isArray(value) && value.every(format => typeof format === "string")); }
export async function clearClipboard(): Promise<void> { await call("clear", {}, isVoid); }
/** The concealed/transient flags to send, checked against the platform. */
function markers(options: object, extra: readonly string[] = []): { concealed?: true; transient?: true } {
  const value = knownOptions(options, ["concealed", "transient", ...extra]);
  const result: { concealed?: true; transient?: true } = {};
  for (const key of ["concealed", "transient"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a boolean`);
    if (value[key]) result[key] = true;
  }
  if (Object.keys(result).length) native("privacyMarkers");
  return result;
}
export async function writeClipboard(content: ClipboardWriteContent, options: ClipboardWriteOptions = {}): Promise<void> {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new SparkError("E_INVALID_ARGUMENT", "Expected clipboard content");
  for (const key of Object.keys(content)) if (!["text", "html", "rtf", "image", "files"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown clipboard format: ${key}`);
  for (const key of ["text", "html", "rtf"] as const) if (content[key] !== undefined && typeof content[key] !== "string") throw new SparkError("E_INVALID_ARGUMENT", `Invalid clipboard ${key}`);
  if (content.files !== undefined && (!Array.isArray(content.files) || Object.entries(content).some(([key, value]) => key !== "files" && value !== undefined))) throw new SparkError("E_INVALID_ARGUMENT", "Files must be written separately from other formats");
  const flags = markers(options);
  const files = content.files?.map(path => nativePath(path, Platform.OS));
  const { image, ...rest } = content;
  if (image !== undefined && (!image || image.format !== "png" || !(image.bytes instanceof Uint8Array))) throw new SparkError("E_INVALID_ARGUMENT", "Expected PNG image bytes");
  const response = await invokeNative(() => callBinary(native(), "__sparkClipboardBinary", "write", { ...rest, files, ...flags }, image?.bytes));
  if (response !== null) throw new SparkError("E_INVALID_DATA", "Invalid native clipboard response");
}

// Promised data: each write's provider lives here until native reports it released (every type provided, or the
// pasteboard replaced). The event subscription exists only while a provider does.
type Provider = { content: PromisedClipboardContent; onError?: (error: SparkError) => void };
const providers = new Map<string, Provider>();
let providerEvents: Subscription | undefined;
const DATA_TYPES: readonly ClipboardDataType[] = ["text", "html", "rtf", "png"];
function report(provider: Provider | undefined, error: SparkError) {
  if (provider?.onError) provider.onError(error); else setTimeout(() => { throw error; });
}
function dataFor(type: ClipboardDataType, data: unknown): ClipboardData {
  if (type === "png" ? data instanceof Uint8Array : typeof data === "string") return data as ClipboardData;
  throw new SparkError("E_INVALID_DATA", type === "png" ? "Promised png data must be a Uint8Array" : `Promised ${type} data must be a string`);
}
async function provide(event: DesktopEvent) {
  const provider = typeof event.id === "string" ? providers.get(event.id) : undefined;
  const type = event.dataType as ClipboardDataType;
  let answer: { text?: string; bytes?: Uint8Array } = {};
  if (provider && DATA_TYPES.includes(type)) {
    try {
      const data = dataFor(type, await provider.content.provide(type));
      answer = typeof data === "string" ? { text: data } : { bytes: data };
    } catch (cause) {
      // The paste gets nothing at once instead of waiting for the timeout.
      report(provider, cause instanceof SparkError ? cause : new SparkError("E_UNAVAILABLE", `Promised ${type} data could not be provided`, { cause }));
    }
  }
  try { await invokeNative(() => callBinary(native(), "__sparkClipboardBinary", "provide", { requestId: event.requestId, ...(answer.text === undefined ? {} : { text: answer.text }) }, answer.bytes)); }
  catch (cause) { report(provider, cause instanceof SparkError ? cause : nativeError(cause)); }
}
function release(id: string) {
  providers.delete(id);
  if (!providers.size) { providerEvents?.remove(); providerEvents = undefined; }
}
/**
 * Replaces the clipboard with representations produced only when something pastes them (macOS). `provide` runs once per
 * type, when asked; the paste waits for it (and the app's main thread with it) up to `timeoutMs`. Promised data is lost
 * when the app quits before a paste. Concealed and transient markers apply as in writeClipboard.
 */
export async function writePromisedClipboard(content: PromisedClipboardContent, options: PromisedClipboardOptions = {}): Promise<void> {
  if (!content || typeof content !== "object" || typeof content.provide !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected promised clipboard content with provide()");
  const types = content.types;
  if (!Array.isArray(types) || !types.length || types.some(type => !DATA_TYPES.includes(type)) || new Set(types).size !== types.length) throw new SparkError("E_INVALID_ARGUMENT", "Expected distinct promised data types: text, html, rtf, png");
  const flags = markers(options, ["timeoutMs", "onError"]);
  const timeoutMs = integerOption(options.timeoutMs, "timeoutMs", 1, 30000, 5000);
  if (options.onError !== undefined && typeof options.onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onError callback");
  native("promisedData");
  const id = token("provider");
  providers.set(id, { content: { types: [...types], provide: content.provide }, onError: options.onError });
  providerEvents ??= onDesktopEvent(event => {
    if (event.type === "clipboardProvide") void provide(event);
    else if (typeof event.id === "string") release(event.id);
  }, { types: ["clipboardProvide", "clipboardProviderReleased"] });
  try { await call("writePromised", { id, types, timeoutMs, ...flags }, isVoid, "promisedData"); }
  catch (error) { release(id); throw error; }
}

/** The clipboard's change count, which every change by any app increments (macOS). */
export async function getClipboardChangeCount(): Promise<number> { return call("changeCount", {}, isCount, "changeEvents"); }
/**
 * Calls `handler` after the clipboard changes, by this app or another (macOS). Polls the change count, which reads no
 * clipboard contents; several changes between two polls arrive as one event. Existing contents are not a change: read
 * getClipboardChangeCount() for the starting point.
 */
export async function onClipboardChange(handler: (event: ClipboardChangeEvent) => void, options: ClipboardChangeOptions = {}): Promise<AsyncRegistration> {
  if (typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected clipboard change handler");
  const intervalMs = integerOption(knownOptions(options, ["intervalMs"]).intervalMs, "intervalMs", 100, 10000, 500);
  native("changeEvents");
  const id = token("observer");
  let stopped = false;
  const subscription = onDesktopEvent(event => {
    if (stopped) return;
    if (isCount(event.changeCount)) { handler({ changeCount: event.changeCount }); return; }
    const error = new SparkError("E_INVALID_DATA", "Clipboard change event without a change count");
    setTimeout(() => { throw error; });
  }, { types: ["clipboardChanged"] });
  try { await call("observe", { id, intervalMs }, isVoid, "changeEvents"); } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => { await call("unobserve", { id }, isVoid, "changeEvents"); });
}
