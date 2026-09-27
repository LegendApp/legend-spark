import { SparkError, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
export type DragOperation = "copy" | "move" | "link";
/** Custom values are UTF-8 strings keyed by MIME type. JSON schemas belong to the app. */
export interface DragPayload { files?: readonly string[]; text?: string; urls?: readonly string[]; data?: Readonly<Record<string, string>> }
/** Logical coordinates from the target's top-left corner, positive downward. */
export interface DragOverEvent { x: number; y: number; operation: DragOperation }
export interface DropEvent extends DragPayload, DragOverEvent {}
export type DragEndEvent = { accepted: true; operation: DragOperation } | { accepted: false; operation: "none" };
export interface DragOptions {
  sourceOperations?: readonly DragOperation[];
  acceptedOperations?: readonly DragOperation[];
  /** Built-ins: files, text, urls. Custom types use MIME names. Default: built-ins. */
  acceptedTypes?: readonly string[];
}
const operations = ["copy", "move", "link"];
const builtins = ["files", "text", "urls"];
const customType = (type: string) => /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && !["application/x-spark-drag", "text/plain", "text/uri-list"].includes(type);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(item => typeof item === "string");
const url = (value: string) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(value) && !/[\u0000-\u0020\u007f]/.test(value);
function invalid(message: string): never { throw new SparkError("E_INVALID_ARGUMENT", message); }
/** Snapshot and normalize file URLs before passing the source to native. */
export function dragSource(source: DragPayload | undefined, platform: string, incoming = false): DragPayload | undefined {
  if (source === undefined) return undefined;
  if (!record(source)) invalid("Expected a drag payload");
  for (const key of Object.keys(source)) if (![...builtins, "data"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown drag payload field: ${key}`);
  const result: DragPayload = {};
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
  if (!incoming && !result.files?.length && result.text === undefined && !result.urls?.length && !Object.keys(result.data ?? {}).length) invalid("Drag source must contain at least one representation");
  return result;
}
export function dragConfiguration(source: DragPayload | undefined, options: DragOptions, platform: string): string {
  dragSource(source, platform);
  if (!record(options)) invalid("Expected drag options");
  for (const key of Object.keys(options)) if (!["sourceOperations", "acceptedOperations", "acceptedTypes"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown drag option: ${key}`);
  for (const values of [options.sourceOperations, options.acceptedOperations]) {
    if (values !== undefined && (!strings(values) || values.some(value => !operations.includes(value)) || new Set(values).size !== values.length)) invalid("Drag operations must be unique copy, move or link values");
  }
  const types = options.acceptedTypes ?? builtins;
  if (!strings(types) || new Set(types).size !== types.length || types.some(type => !builtins.includes(type) && !customType(type))) invalid("Invalid or duplicate accepted drag type");
  return JSON.stringify({ sourceOperations: options.sourceOperations ?? ["copy"], acceptedOperations: options.acceptedOperations ?? ["copy"], acceptedTypes: types });
}
function position(value: unknown): value is DragOverEvent {
  return record(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && operations.includes(value.operation as string);
}
export function dragPosition(json: string): DragOverEvent {
  const { x, y, operation } = parseNativeResult(json, position); return { x, y, operation };
}
export function dragEnd(json: string): DragEndEvent {
  const value = parseNativeResult(json, (value): value is DragEndEvent => record(value) && (value.accepted === true ? operations.includes(value.operation as string) : value.accepted === false && value.operation === "none"));
  return { accepted: value.accepted, operation: value.operation } as DragEndEvent;
}
export function dragDrop(json: string, platform: string): DropEvent {
  const value = parseNativeResult(json, (value): value is DropEvent => position(value) && record(value));
  // Native drops may contain no text/custom representation, unlike a requested source.
  const { x, y, operation } = value;
  const payload: DragPayload = {};
  for (const key of [...builtins, "data"] as const) if (Object.hasOwn(value, key)) (payload as Record<string, unknown>)[key] = (value as unknown as Record<string, unknown>)[key];
  try {
    const normalized = dragSource(payload, platform, true);
    return { ...normalized, x, y, operation };
  } catch (cause) { throw new SparkError("E_INVALID_DATA", "Invalid native drag payload", { cause }); }
}
