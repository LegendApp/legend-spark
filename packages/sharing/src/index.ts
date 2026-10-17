import { findNodeHandle, Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, parseNativeResult, type AsyncRegistration, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native, { type Spec } from "./NativeDesktopSharing";
export type { AsyncRegistration, Availability, Subscription } from "@legendapp/spark-desktop-app/src/contracts";

/** A sharing capability, for `getSharingAvailability(feature)`: the share picker, the Services menu, or Core Spotlight indexing. */
export type SharingFeature = "share" | "services" | "spotlight";
/** What the share picker offers to services: text, a web URL, or a local file (absolute path or file URL). */
export type ShareItem = { type: "text"; text: string } | { type: "url"; url: string } | { type: "file"; path: string };
/** Options for `share`. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface ShareOptions {
  /** A mounted view (a ref) the picker points at. Default: the key window's content. */
  anchor?: object;
}
/** service: the title of the service the person chose (localized, for example "Mail"), or null when they dismissed the picker. */
export interface ShareResult { service: string | null }
/** What the person sent from another app's Services menu: its text, files (absolute paths) and web URLs. */
export interface ServiceInvocation { name: string; text: string | null; files: string[]; urls: string[] }
/** Options for `addServiceListener` and `addSpotlightListener`. Unknown keys throw E_UNSUPPORTED_OPTION. */
export interface ListenerOptions {
  /** Malformed native events and errors thrown by the listener. Default: console.error. */
  onError?: (error: SparkError) => void;
}
/** An item for `indexSpotlightItems`. `id` and `title` must be nonempty. */
export interface SpotlightItem {
  /** Unique in the app's index; indexing the same id again replaces the item. */
  id: string;
  title: string;
  /** Groups items so deleteSpotlightItems({ domains }) removes them together. */
  domain?: string;
  description?: string;
  keywords?: readonly string[];
  /** Unix ms after which Spotlight drops the item. Default: Core Spotlight's (30 days after indexing). */
  expiresAt?: number;
}
/** Which items `deleteSpotlightItems` removes: by id, by domain, or all of them. */
export type SpotlightDeletion = { ids: readonly string[] } | { domains: readonly string[] } | { all: true };
/** Payload of `addSpotlightListener`: the `id` of the Spotlight item the person opened. */
export interface SpotlightOpenEvent { id: string }

/** macOS only. Windows reports `unsupported-platform` (#392). */
export function getSharingAvailability(feature: SharingFeature): Availability {
  if (feature !== "share" && feature !== "services" && feature !== "spotlight") throw new SparkError("E_INVALID_ARGUMENT", `Unknown sharing feature: ${String(feature)}`);
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(feature: SharingFeature): Spec {
  const availability = getSharingAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Sharing requires macOS with NativeDesktopSharing installed");
  return Native!;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isNull = (value: unknown): value is null => value === null;
function known(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${label}`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${label} field: ${key}`);
  return value;
}
function texts(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || !value.every(isText)) throw new SparkError("E_INVALID_ARGUMENT", `${label} is a non-empty list of strings`);
  return [...value];
}
async function call<T>(native: Spec, method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}
function report(options: ListenerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }
function listenerOptions(listener: unknown, options: unknown): ListenerOptions {
  const checked = known(options, ["onError"], "listener options");
  if (typeof listener !== "function" || (checked.onError !== undefined && typeof checked.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener function");
  return checked as ListenerOptions;
}

function shareItem(value: unknown) {
  const type = isRecord(value) ? value.type : undefined;
  if (type === "text") { const { text } = known(value, ["type", "text"], "text item"); if (isText(text)) return { type, text }; }
  else if (type === "url") { const { url } = known(value, ["type", "url"], "URL item"); if (isText(url) && /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) return { type, url }; }
  else if (type === "file") return { type, path: nativePath(known(value, ["type", "path"], "file item").path as string, Platform.OS) };
  throw new SparkError("E_INVALID_ARGUMENT", "A share item is { type: \"text\", text }, { type: \"url\", url } (not a file URL) or { type: \"file\", path }");
}

/**
 * Shows the share picker for the items and resolves once the person picks a service or dismisses it; the chosen
 * service then finishes on its own (a Mail draft, a Messages conversation). One picker at a time (E_BUSY). A file that
 * does not exist rejects E_NOT_FOUND; without an anchor or a visible window, E_UNAVAILABLE.
 */
export async function share(items: readonly ShareItem[], options: ShareOptions = {}): Promise<ShareResult> {
  if (!Array.isArray(items) || !items.length) throw new SparkError("E_INVALID_ARGUMENT", "Expected at least one share item");
  const wire = items.map(shareItem);
  const { anchor } = known(options, ["anchor"], "share options");
  let tag: number | undefined;
  if (anchor !== undefined) {
    if (!anchor || typeof anchor !== "object") throw new SparkError("E_INVALID_ARGUMENT", "anchor is a mounted view ref");
    const handle = findNodeHandle(anchor as never);
    if (typeof handle !== "number") throw new SparkError("E_NOT_FOUND", "The anchor view is not mounted");
    tag = handle;
  }
  return call(requireAvailable("share"), "share", { items: wire, tag }, (value): value is ShareResult =>
    isRecord(value) && Object.keys(value).length === 1 && (value.service === null || isText(value.service)));
}

const isInvocation = (value: Record<string, unknown>) => isText(value.name) && (value.text === null || typeof value.text === "string")
  && Array.isArray(value.files) && value.files.every(isText) && Array.isArray(value.urls) && value.urls.every(isText);
/**
 * Receives the service `name` that another app's Services menu sends to this app. The app's Info.plist declares it:
 * an NSServices entry with NSMessage `sparkService` and NSUserData `name` (docs/sharing.md#services); without one this
 * rejects E_UNAVAILABLE, and a service that declares NSReturnTypes rejects E_UNSUPPORTED_OPTION. One listener per name (E_BUSY).
 */
export async function addServiceListener(name: string, listener: (invocation: ServiceInvocation) => void, options: ListenerOptions = {}): Promise<AsyncRegistration> {
  if (!isText(name)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a service name");
  const checked = listenerOptions(listener, options);
  const native = requireAvailable("services");
  let stopped = false;
  const subscription = onDesktopEvent(event => {
    if (stopped) return;
    if (!isInvocation(event)) { report(checked, new SparkError("E_INVALID_DATA", "Malformed service invocation")); return; }
    try { listener({ name, text: event.text as string | null, files: event.files as string[], urls: event.urls as string[] }); }
    catch (cause) { report(checked, cause); }
  }, { types: ["serviceInvoked"], target: { field: "name", value: name } });
  try { await call(native, "registerService", { name }, isNull); }
  catch (cause) { stopped = true; subscription.remove(); throw cause; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => { await call(native, "unregisterService", { name }, isNull); });
}

function spotlightItem(value: unknown) {
  const item = known(value, ["id", "title", "domain", "description", "keywords", "expiresAt"], "Spotlight item");
  const valid = isText(item.id) && isText(item.title) && (item.domain === undefined || isText(item.domain)) && (item.description === undefined || isText(item.description))
    && (item.expiresAt === undefined || (typeof item.expiresAt === "number" && Number.isFinite(item.expiresAt)));
  if (!valid) throw new SparkError("E_INVALID_ARGUMENT", "A Spotlight item has an id and title, and optional domain, description, keywords and expiresAt (Unix ms)");
  return item.keywords === undefined ? item : { ...item, keywords: texts(item.keywords, "keywords") };
}
/** Adds the items to the app's Core Spotlight index, replacing items with the same id. Resolves once the index has them. */
export async function indexSpotlightItems(items: readonly SpotlightItem[]): Promise<void> {
  if (!Array.isArray(items) || !items.length) throw new SparkError("E_INVALID_ARGUMENT", "Expected at least one Spotlight item");
  const wire = items.map(spotlightItem);
  if (new Set(wire.map(item => item.id)).size !== wire.length) throw new SparkError("E_INVALID_ARGUMENT", "Spotlight item ids must be unique");
  await call(requireAvailable("spotlight"), "index", { items: wire }, isNull);
}
/** Removes items from the app's index by id, by domain, or all of them. Ids or domains that are not indexed are not an error. */
export async function deleteSpotlightItems(target: SpotlightDeletion): Promise<void> {
  const keys = isRecord(target) ? Object.keys(target) : [];
  let args: object;
  if (keys.length === 1 && keys[0] === "ids") args = { ids: texts((target as { ids: unknown }).ids, "ids") };
  else if (keys.length === 1 && keys[0] === "domains") args = { domains: texts((target as { domains: unknown }).domains, "domains") };
  else if (keys.length === 1 && keys[0] === "all" && (target as { all: unknown }).all === true) args = {};
  else throw new SparkError("E_INVALID_ARGUMENT", "Delete Spotlight items with { ids }, { domains } or { all: true }");
  await call(requireAvailable("spotlight"), "delete", args, isNull);
}
/**
 * Calls `listener` when the person opens one of the app's items from Spotlight. Items opened before the first listener
 * in this process (the opening that launched the app) are delivered to it once, after it is added.
 */
export function addSpotlightListener(listener: (event: SpotlightOpenEvent) => void, options: ListenerOptions = {}): Subscription {
  const checked = listenerOptions(listener, options);
  const native = requireAvailable("spotlight");
  let stopped = false;
  const deliver = (id: unknown) => {
    if (stopped) return;
    if (!isText(id)) { report(checked, new SparkError("E_INVALID_DATA", "Malformed Spotlight event")); return; }
    try { listener({ id }); } catch (cause) { report(checked, cause); }
  };
  // A held opening also comes back from takeSpotlightItems, which delivers it.
  const subscription = onDesktopEvent(event => { if (event.held !== true) deliver(event.identifier); }, { types: ["spotlightItemOpened"] });
  call(native, "takeSpotlightItems", {}, (value): value is unknown[] => Array.isArray(value)).then(held => held.forEach(deliver), cause => report(checked, cause));
  return { remove() { stopped = true; subscription.remove(); } };
}
