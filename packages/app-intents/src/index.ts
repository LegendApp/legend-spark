import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, parseNativeResult, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native, { type Spec } from "./NativeDesktopAppIntents";
export type { AsyncRegistration, Availability } from "@legendapp/spark-desktop-app/src/contracts";

/** Value type of an App Intent parameter, as declared in macos.appIntents: a built-in type, an enum or an entity. */
export type AppIntentParameterType = "string" | "number" | "integer" | "boolean" | "enum" | "entity";
/**
 * A declared parameter. An enum parameter's value is one of `values` (the case values of its macos.appEnums enum); an
 * entity parameter's is the id of one of `entity`'s entities (macos.appEntities). `default` is the value the system
 * starts with.
 */
export type AppIntentParameter = { name: string; title: string; optional: boolean; default?: string | number | boolean } & (
  | { type: "string" | "number" | "integer" | "boolean" }
  | { type: "enum"; values: string[] }
  | { type: "entity"; entity: string });
/** An intent the app declares in macos.appIntents (docs/app-intents.md#declaring-intents). */
export interface AppIntent { id: string; title: string; parameters: AppIntentParameter[]; returnsText: boolean }
/** A parameter value: text, a finite number, a boolean, or null for an optional parameter left empty. */
export type AppIntentValue = string | number | boolean | null;
/** Parameter values by name; an optional parameter the person left empty is null. */
export type AppIntentParameters = Record<string, AppIntentValue>;
/** One run of an intent, passed to an `AppIntentHandler`: the intent `id` and its parameter values. */
export interface AppIntentInvocation { id: string; parameters: AppIntentParameters }
/**
 * Runs an invocation. Return the result text for an intent declared with returnsText (the system shows it and passes
 * it to the next action), nothing otherwise. Throwing fails the intent: the system shows the error's message.
 */
export type AppIntentHandler = (invocation: AppIntentInvocation) => string | void | Promise<string | void>;
/** Options for `addAppIntentHandler` and `addAppEntityQueryHandler`. */
export interface AppIntentHandlerOptions {
  /** Malformed native events and answers the system no longer waits for (the request timed out). Default: console.error. */
  onError?: (error: SparkError) => void;
}
/** An entity the system shows and passes to intents by its id: in Shortcuts' pickers, search and parameters. */
export interface AppEntityItem { id: string; title: string; subtitle?: string }
/**
 * What the system asks an entity's query handler for: the entities with these ids (to show or run an intent with
 * them), the ones to suggest (a picker without search text), or the ones matching search text.
 */
export type AppEntityQuery = { entity: string } & ({ kind: "identifiers"; identifiers: string[] } | { kind: "suggested" } | { kind: "search"; text: string });
/** Answers a query with the entities it asks for, in the order to show them; throwing fails the query. */
export type AppEntityQueryHandler = (query: AppEntityQuery) => AppEntityItem[] | Promise<AppEntityItem[]>;

/**
 * Whether the system can run this app's intents: macOS, in a build of an app that declares them (macos.appIntents).
 * The Spark Runner cannot carry an app's intents and reports `host-restriction`; Windows reports `unsupported-platform`.
 */
export function getAppIntentsAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  return Native.isAvailable() ? { available: true } : { available: false, reason: "host-restriction" };
}
function native(): Spec {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "App Intents require macOS");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "App Intents require NativeDesktopAppIntents");
  return Native;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const isNull = (value: unknown): value is null => value === null;
const isValue = (value: unknown): value is AppIntentValue => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const isParameters = (value: unknown): value is AppIntentParameters => isRecord(value) && Object.values(value).every(isValue);
const isParameter = (value: unknown): value is AppIntentParameter => isRecord(value) && isText(value.name) && isText(value.title) && typeof value.optional === "boolean"
  && (value.default === undefined || (value.default !== null && isValue(value.default)))
  && (value.type === "enum" ? isTexts(value.values) : value.type === "entity" ? isText(value.entity) : ["string", "number", "integer", "boolean"].includes(value.type as string));
const isIntent = (value: unknown): value is AppIntent => isRecord(value) && isText(value.id) && isText(value.title) && typeof value.returnsText === "boolean"
  && Array.isArray(value.parameters) && value.parameters.every(isParameter);
const isQuery = (value: unknown): value is Omit<AppEntityQuery, "entity"> => isRecord(value)
  && (value.kind === "identifiers" ? isTexts(value.identifiers) : value.kind === "search" ? typeof value.text === "string" : value.kind === "suggested");
const isItems = (value: unknown): value is AppEntityItem[] => Array.isArray(value) && new Set(value.map(item => isRecord(item) ? item.id : undefined)).size === value.length
  && value.every(item => isRecord(item) && isText(item.id) && isText(item.title) && (item.subtitle === undefined || typeof item.subtitle === "string")
    && Object.keys(item).every(key => key === "id" || key === "title" || key === "subtitle"));
async function call<T>(spec: Spec, method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => spec.call(method, JSON.stringify(args))), validate);
}
function report(options: AppIntentHandlerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }
function checkId(id: unknown, what: string): string {
  if (!isText(id)) throw new SparkError("E_INVALID_ARGUMENT", `Expected an ${what} id`);
  return id;
}
function checkHandler(handler: unknown, options: unknown): asserts options is AppIntentHandlerOptions {
  if (typeof handler !== "function" || !isRecord(options) || Object.keys(options).some(key => key !== "onError") || (options.onError !== undefined && typeof options.onError !== "function"))
    throw new SparkError("E_INVALID_ARGUMENT", "Expected a handler function and { onError? }");
}

/**
 * Takes the requests native delivers for one intent (`{ id }`) or entity (`{ entity }`): each event runs `answer`,
 * whose result or error goes back to the system. Requests that arrive before native confirms the registration wait for
 * it: when it is refused (for example E_BUSY, because another handler has the id) they belong to that other handler
 * and are dropped.
 */
async function addHandler(target: { id: string } | { entity: string }, type: string, answer: (event: Record<string, unknown>) => Promise<object> | undefined, options: AppIntentHandlerOptions): Promise<AsyncRegistration> {
  const spec = native();
  let stopped = false;
  const deliver = (event: Record<string, unknown>) => {
    const requestId = event.requestId;
    const result = isText(requestId) ? answer(event) : undefined;
    if (!result) { report(options, new SparkError("E_INVALID_DATA", "Malformed App Intents request")); return; }
    void result.then(async value => {
      try { await call(spec, "answer", { requestId, ...value }, isNull); } catch (cause) { if (!stopped) report(options, cause); }
    });
  };
  let pending: Record<string, unknown>[] | undefined = [];
  const [field, value] = Object.entries(target)[0]!;
  const subscription = onDesktopEvent(event => {
    if (stopped) return;
    if (pending) pending.push(event); else deliver(event);
  }, { types: [type], target: { field, value } });
  try { await call(spec, "register", target, isNull); }
  catch (cause) { stopped = true; pending = undefined; subscription.remove(); throw cause; }
  const waiting = pending;
  pending = undefined;
  waiting.forEach(deliver);
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => { await call(spec, "unregister", target, isNull); });
}
// The handler's result, or its error as the system gets it.
async function settle<T>(run: () => T | Promise<T>, check: (value: T) => object): Promise<object> {
  try { return check(await run()); }
  catch (cause) { const error = nativeError(cause); return { error: { code: error.code, message: error.message } }; }
}

/** The intents the system can run in this app, as macos.appIntents declares them; empty when it cannot run any. */
export async function getAppIntents(): Promise<AppIntent[]> {
  return call(native(), "declarations", {}, (value): value is AppIntent[] => Array.isArray(value) && value.every(isIntent));
}

/**
 * Runs `handler` whenever Shortcuts, Spotlight or Siri runs the intent `id`, and answers the system with its result.
 * Invocations that arrive before the handler (the one that launched the app) wait for it, up to 30 seconds from their
 * start; the system then gets E_TIMEOUT. Rejects E_UNAVAILABLE when the system cannot run this app's intents (see
 * getAppIntentsAvailability), E_NOT_FOUND for an id macos.appIntents does not declare, and E_BUSY when the id already
 * has a handler. `remove()` fails invocations the handler has not answered yet with E_CLOSED.
 */
export async function addAppIntentHandler(id: string, handler: AppIntentHandler, options: AppIntentHandlerOptions = {}): Promise<AsyncRegistration> {
  checkId(id, "App Intent");
  checkHandler(handler, options);
  return addHandler({ id }, "appIntentInvoked", event => isParameters(event.parameters) ? settle(() => handler({ id, parameters: event.parameters as AppIntentParameters }), text => {
    if (text !== undefined && typeof text !== "string") throw new SparkError("E_INVALID_DATA", `The handler for ${id} returned ${typeof text}; return text or nothing`);
    return { text: text ?? null };
  }) : undefined, options);
}

/**
 * Answers the system's queries for the entity `entity` (macos.appEntities): the entities with given ids, the ones to
 * suggest, and the ones matching search text, which Shortcuts shows in pickers and passes to intents by id. Queries
 * wait for the handler and complete once, as invocations do (addAppIntentHandler); a result that is not a list of
 * `{ id, title, subtitle? }` with unique ids fails the query with E_INVALID_DATA. Rejects E_UNAVAILABLE, E_NOT_FOUND
 * for an entity macos.appEntities does not declare, and E_BUSY when it already has a query handler.
 */
export async function addAppEntityQueryHandler(entity: string, handler: AppEntityQueryHandler, options: AppIntentHandlerOptions = {}): Promise<AsyncRegistration> {
  checkId(entity, "App Entity");
  checkHandler(handler, options);
  return addHandler({ entity }, "appEntityQueried", event => isQuery(event.query) ? settle(() => handler({ ...event.query as Omit<AppEntityQuery, "entity">, entity } as AppEntityQuery), entities => {
    if (!isItems(entities)) throw new SparkError("E_INVALID_DATA", `The query handler for ${entity} must return a list of { id, title, subtitle? } with unique ids`);
    return { entities };
  }) : undefined, options);
}

/**
 * Tells the system the person just did what the intent does, with these parameters, so Siri and Spotlight can suggest
 * it later (IntentDonationManager). Parameters are checked against the declaration (E_INVALID_ARGUMENT); an entity
 * parameter is its id, which the entity's query handler resolves.
 */
export async function donateAppIntent(id: string, parameters: AppIntentParameters = {}): Promise<void> {
  checkId(id, "App Intent");
  if (!isParameters(parameters)) throw new SparkError("E_INVALID_ARGUMENT", "Parameters are an object of strings, finite numbers, booleans or null");
  await call(native(), "donate", { id, parameters }, isNull);
}
