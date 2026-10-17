import { SparkError, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
/** A drag operation a source allows or a destination performs. */
export type DragOperation = "copy" | "move" | "link";
/** Custom values are UTF-8 strings keyed by MIME type. JSON schemas belong to the app. */
export interface DragPayload { files?: readonly string[]; text?: string; urls?: readonly string[]; data?: Readonly<Record<string, string>> }
/** A file the source promises and writes only when a destination such as Finder accepts it (macOS). */
export interface PromisedFile {
  /** File name, with extension, that the destination folder receives. */
  name: string;
  /** MIME type. Default: derived from the name's extension. */
  type?: string;
}
/** What a drag source offers: payload representations and promised files. */
export interface DragSource extends DragPayload { promisedFiles?: readonly PromisedFile[] }
/** A destination asks for a promised file: write it at `path` (an absolute native path in the destination's folder). */
export interface PromisedFileWriteRequest { name: string; path: string }
/** The image under the pointer while dragging (macOS): a snapshot of the view, or an image file at a size in points. */
export type DragImage = "view" | { path: string; width: number; height: number };
/** Source operations by where the drag ends: within this app, or in another app such as Finder. */
export interface ContextualDragOperations { withinApp: readonly DragOperation[]; outsideApp: readonly DragOperation[] }
/** Spring-loading highlight a destination draws while a drag hovers (macOS). */
export type SpringLoadHighlight = "none" | "standard" | "emphasized";
/** Payload of `onSpringLoadHighlight` on `DragDropView`. */
export interface SpringLoadHighlightEvent { highlight: SpringLoadHighlight }
/** Logical coordinates from the target's top-left corner, positive downward. */
export interface DragOverEvent {
  x: number; y: number; operation: DragOperation;
  /** Operations the source allows after the modifier keys the user holds narrow them (macOS). */
  allowedOperations?: DragOperation[];
}
/** Payload of `onDrop` and `onDragEnter` on `DragDropView`: the dragged representations plus the pointer position and operation. */
export interface DropEvent extends DragPayload, DragOverEvent {}
/** Payload of `onDragEnd` on `DragDropView`: whether a destination accepted the drag this view started, and with which operation. */
export type DragEndEvent = { accepted: true; operation: DragOperation } | { accepted: false; operation: "none" };
/** Drag source and drop target options for `DragDropView`. Unknown keys throw E_UNSUPPORTED_OPTION; a macOS-only option on another platform throws E_UNSUPPORTED_PLATFORM. */
export interface DragOptions {
  /** Operations a source allows; contextual operations differ within the app and outside it (macOS). Default: copy. */
  sourceOperations?: readonly DragOperation[] | ContextualDragOperations;
  /** Keep every source operation when the user holds Option, Command or Control (macOS). Default: false. */
  ignoreModifierKeys?: boolean;
  /** Custom drag image (macOS). Default: a document symbol. */
  dragImage?: DragImage;
  acceptedOperations?: readonly DragOperation[];
  /** Built-ins: files, text, urls. Custom types use MIME names. Default: built-ins. */
  acceptedTypes?: readonly string[];
  /** Spring-load when a drag of an accepted type hovers (macOS): onSpringLoad after the system's springing delay. Default: false. */
  springLoading?: boolean;
  /** Tear the source off (macOS): a drag no destination accepts that ends outside every window of the app calls `onTearOff` with where the view landed. Needs `source` and `onTearOff`. Default: false. */
  tearOff?: boolean;
}
/** Payload of `onTearOff` on `DragDropView`: where the dragged view landed, in the source window's content from its top-left corner, as `measureInWindow` reports it (outside the window's bounds, so often negative or past its size). With the window's ID it is a `WindowContentRect` for `openWindowFrom`. */
export interface TearOffEvent { x: number; y: number; width: number; height: number }
/** Capabilities beyond basic drag and drop, by platform. */
export type DragDropFeature = "promisedFiles" | "springLoading" | "dragImage" | "operationMasks" | "tearOff";
export const DRAG_DROP_FEATURES: readonly DragDropFeature[] = ["promisedFiles", "springLoading", "dragImage", "operationMasks", "tearOff"];
/** Platforms implementing each feature (Windows: #365). */
export const DRAG_DROP_FEATURE_PLATFORMS: Readonly<Record<DragDropFeature, readonly string[]>> = { promisedFiles: ["macos"], springLoading: ["macos"], dragImage: ["macos"], operationMasks: ["macos"], tearOff: ["macos"] };
const operations = ["copy", "move", "link"];
const builtins = ["files", "text", "urls"];
const mime = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const customType = (type: string) => mime.test(type) && !["application/x-spark-drag", "text/plain", "text/uri-list"].includes(type);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(item => typeof item === "string");
const url = (value: string) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(value) && !/[\u0000- \u007f]/.test(value);
function invalid(message: string): never { throw new SparkError("E_INVALID_ARGUMENT", message); }
function requireFeature(feature: DragDropFeature, platform: string) {
  if (!DRAG_DROP_FEATURE_PLATFORMS[feature].includes(platform)) throw new SparkError("E_UNSUPPORTED_PLATFORM", `Drag and drop ${feature} is unavailable on this platform`);
}
function promisedFiles(files: unknown, platform: string): PromisedFile[] {
  if (!Array.isArray(files) || !files.length) invalid("promisedFiles must be a non-empty array");
  requireFeature("promisedFiles", platform);
  const names = new Set<string>();
  return files.map(file => {
    if (!record(file) || Object.keys(file).some(key => key !== "name" && key !== "type")) invalid("A promised file is { name, type? }");
    const { name, type } = file;
    if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\u0000:]/.test(name) || name.length > 255) invalid("A promised file name is a file name without a folder");
    if (names.has(name)) invalid(`Duplicate promised file name: ${name}`);
    names.add(name);
    if (type !== undefined && (typeof type !== "string" || !mime.test(type))) invalid("A promised file type is a MIME type");
    return type === undefined ? { name } : { name, type };
  });
}
/** Snapshot and normalize file URLs before passing the source to native. */
export function dragSource(source: DragSource | undefined, platform: string, incoming = false): DragSource | undefined {
  if (source === undefined) return undefined;
  if (!record(source)) invalid("Expected a drag payload");
  for (const key of Object.keys(source)) if (![...builtins, "data", ...(incoming ? [] : ["promisedFiles"])].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown drag payload field: ${key}`);
  const result: DragSource = {};
  if (source.files !== undefined) {
    if (!strings(source.files)) invalid("Drag files must be an array of absolute paths or file URLs");
    result.files = source.files.map(file => nativePath(file, platform));
  }
  if (source.text !== undefined) {
    if (typeof source.text !== "string") invalid("Drag text must be a string");
    result.text = source.text;
  }
  if (source.urls !== undefined) {
    if (!strings(source.urls) || !source.urls.every(url)) invalid("Drag URLs must be absolute URLs without whitespace");
    if (!incoming && platform === "windows" && source.urls.length > 1) throw new SparkError("E_UNSUPPORTED_OPTION", "Windows supports one URL per drag source");
    result.urls = [...source.urls];
  }
  if (source.data !== undefined) {
    if (!record(source.data) || Object.entries(source.data).some(([type, value]) => !customType(type) || typeof value !== "string")) invalid("Custom drag data must map MIME types to strings");
    result.data = { ...source.data } as Record<string, string>;
  }
  if (source.promisedFiles !== undefined) result.promisedFiles = promisedFiles(source.promisedFiles, platform);
  if (!incoming && !result.files?.length && result.text === undefined && !result.urls?.length && !Object.keys(result.data ?? {}).length && !result.promisedFiles?.length) invalid("Drag source must contain at least one representation");
  return result;
}
export function dragConfiguration(source: DragSource | undefined, options: DragOptions, platform: string): string {
  dragSource(source, platform);
  return dragOptions(options, platform);
}
function operationList(values: unknown, name: string): DragOperation[] {
  if (!strings(values) || values.some(value => !operations.includes(value)) || new Set(values).size !== values.length) invalid(`${name} must be unique copy, move or link values`);
  return [...values] as DragOperation[];
}
function dragImage(image: unknown, platform: string): DragImage {
  requireFeature("dragImage", platform);
  if (image === "view") return image;
  if (!record(image) || Object.keys(image).some(key => !["path", "width", "height"].includes(key))) invalid('dragImage is "view" or { path, width, height }');
  const { width, height } = image;
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0 && width <= 1024) || !(height > 0 && height <= 1024)) invalid("dragImage width and height are points from 1 to 1024");
  return { path: nativePath(image.path as string, platform), width, height };
}
const OPTION_KEYS = ["sourceOperations", "ignoreModifierKeys", "dragImage", "acceptedOperations", "acceptedTypes", "springLoading", "tearOff"];
export function dragOptions(options: DragOptions, platform: string): string {
  if (!record(options)) invalid("Expected drag options");
  for (const key of Object.keys(options)) if (!OPTION_KEYS.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown drag option: ${key}`);
  const { sourceOperations = ["copy"], acceptedOperations = ["copy"], acceptedTypes: types = builtins, ignoreModifierKeys, springLoading, tearOff, dragImage: image } = options;
  let within: DragOperation[], outside: DragOperation[];
  if (record(sourceOperations)) {
    if (Object.keys(sourceOperations).some(key => key !== "withinApp" && key !== "outsideApp")) invalid("Contextual sourceOperations are { withinApp, outsideApp }");
    requireFeature("operationMasks", platform);
    within = operationList(sourceOperations.withinApp, "sourceOperations.withinApp"); outside = operationList(sourceOperations.outsideApp, "sourceOperations.outsideApp");
  } else within = outside = operationList(sourceOperations, "sourceOperations");
  const accepted = operationList(acceptedOperations, "acceptedOperations");
  if (!strings(types) || new Set(types).size !== types.length || types.some(type => !builtins.includes(type) && !customType(type))) invalid("Invalid or duplicate accepted drag type");
  for (const [name, value] of [["ignoreModifierKeys", ignoreModifierKeys], ["springLoading", springLoading], ["tearOff", tearOff]] as const) if (value !== undefined && typeof value !== "boolean") invalid(`${name} must be a boolean`);
  if (ignoreModifierKeys) requireFeature("operationMasks", platform);
  if (springLoading) requireFeature("springLoading", platform);
  if (tearOff) requireFeature("tearOff", platform);
  return JSON.stringify({ sourceOperations: within, externalOperations: outside, acceptedOperations: accepted, acceptedTypes: [...types], ignoreModifierKeys: ignoreModifierKeys ?? false,
    springLoading: springLoading ?? false, ...(tearOff ? { tearOff } : {}), ...(image === undefined ? {} : { dragImage: dragImage(image, platform) }) });
}
function position(value: unknown): value is DragOverEvent {
  return record(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && operations.includes(value.operation as string)
    && (value.allowedOperations === undefined || (strings(value.allowedOperations) && value.allowedOperations.every(operation => operations.includes(operation))));
}
export function dragPosition(json: string): DragOverEvent {
  const { x, y, operation, allowedOperations } = parseNativeResult(json, position);
  return allowedOperations === undefined ? { x, y, operation } : { x, y, operation, allowedOperations };
}
export function dragEnd(json: string): DragEndEvent {
  const value = parseNativeResult(json, (value): value is DragEndEvent => record(value) && (value.accepted === true ? operations.includes(value.operation as string) : value.accepted === false && value.operation === "none"));
  return { accepted: value.accepted, operation: value.operation } as DragEndEvent;
}
export function dragDrop(json: string, platform: string): DropEvent {
  const value = parseNativeResult(json, (value): value is DropEvent => position(value) && record(value));
  // Native drops may contain no text/custom representation, unlike a requested source.
  const { x, y, operation, allowedOperations } = value;
  const payload: DragPayload = {};
  for (const key of [...builtins, "data"] as const) if (Object.hasOwn(value, key)) (payload as Record<string, unknown>)[key] = (value as unknown as Record<string, unknown>)[key];
  try {
    const normalized = dragSource(payload, platform, true);
    return { ...normalized, x, y, operation, ...(allowedOperations === undefined ? {} : { allowedOperations }) };
  } catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid native drag payload", { cause }); }
}
/** A native promised-file write request: its id, file name and absolute destination path. */
export function promisedFileRequest(json: string): PromisedFileWriteRequest & { id: number } {
  const { id, name, path } = parseNativeResult(json, (value): value is PromisedFileWriteRequest & { id: number } =>
    record(value) && Number.isSafeInteger(value.id) && typeof value.name === "string" && typeof value.path === "string" && value.path.startsWith("/"));
  return { id, name, path };
}
const rectangle = (value: unknown): value is TearOffEvent => record(value) && ["x", "y", "width", "height"].every(key => typeof value[key] === "number" && Number.isFinite(value[key])) && (value.width as number) >= 0 && (value.height as number) >= 0;
export function tearOffEvent(json: string): TearOffEvent {
  const { x, y, width, height } = parseNativeResult(json, rectangle);
  return { x, y, width, height };
}
export function springLoadHighlight(json: string): SpringLoadHighlightEvent {
  const { highlight } = parseNativeResult(json, (value): value is SpringLoadHighlightEvent => record(value) && ["none", "standard", "emphasized"].includes(value.highlight as string));
  return { highlight };
}
