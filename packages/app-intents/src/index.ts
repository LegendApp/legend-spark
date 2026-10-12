import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, parseNativeResult, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native, { type Spec } from "./NativeDesktopAppIntents";
export type { AsyncRegistration, Availability } from "@legendapp/spark-desktop-app/src/contracts";

export type AppIntentParameterType = "string" | "number" | "integer" | "boolean";
export interface AppIntentParameter { name: string; title: string; type: AppIntentParameterType; optional: boolean }
/** An intent the app declares in macos.appIntents (docs/app-intents.md#declaring-intents). */
export interface AppIntent { id: string; title: string; parameters: AppIntentParameter[]; returnsText: boolean }
export type AppIntentValue = string | number | boolean | null;
/** Parameter values by name; an optional parameter the person left empty is null. */
export type AppIntentParameters = Record<string, AppIntentValue>;
export interface AppIntentInvocation { id: string; parameters: AppIntentParameters }
/**
 * Runs an invocation. Return the result text for an intent declared with returnsText (the system shows it and passes
 * it to the next action), nothing otherwise. Throwing fails the intent: the system shows the error's message.
 */
export type AppIntentHandler = (invocation: AppIntentInvocation) => string | void | Promise<string | void>;
export interface AppIntentHandlerOptions {
  /** Malformed native events and answers the system no longer waits for (the invocation timed out). Default: console.error. */
  onError?: (error: SparkError) => void;
}

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
const isNull = (value: unknown): value is null => value === null;
const isValue = (value: unknown): value is AppIntentValue => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
const isParameters = (value: unknown): value is AppIntentParameters => isRecord(value) && Object.values(value).every(isValue);
const isIntent = (value: unknown): value is AppIntent => isRecord(value) && isText(value.id) && isText(value.title) && typeof value.returnsText === "boolean"
  && Array.isArray(value.parameters) && value.parameters.every(parameter => isRecord(parameter) && isText(parameter.name) && isText(parameter.title)
    && ["string", "number", "integer", "boolean"].includes(parameter.type as string) && typeof parameter.optional === "boolean");
async function call<T>(spec: Spec, method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => spec.call(method, JSON.stringify(args))), validate);
}
function report(options: AppIntentHandlerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }
function intentId(id: unknown): string {
  if (!isText(id)) throw new SparkError("E_INVALID_ARGUMENT", "Expected an App Intent id");
  return id;
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
  intentId(id);
  if (typeof handler !== "function" || !isRecord(options) || Object.keys(options).some(key => key !== "onError") || (options.onError !== undefined && typeof options.onError !== "function"))
    throw new SparkError("E_INVALID_ARGUMENT", "Expected a handler function and { onError? }");
  const spec = native();
  let stopped = false;
  const run = async (requestId: string, parameters: AppIntentParameters) => {
    let answer: object;
    try {
      const text = await handler({ id, parameters });
      if (text !== undefined && typeof text !== "string") throw new SparkError("E_INVALID_DATA", `The handler for ${id} returned ${typeof text}; return text or nothing`);
      answer = { requestId, text: text ?? null };
    } catch (cause) {
      const error = nativeError(cause);
      answer = { requestId, error: { code: error.code, message: error.message } };
    }
    try { await call(spec, "answer", answer, isNull); } catch (cause) { if (!stopped) report(options, cause); }
  };
  const deliver = (event: Record<string, unknown>) => {
    if (!isText(event.requestId) || !isParameters(event.parameters)) { report(options, new SparkError("E_INVALID_DATA", "Malformed App Intent invocation")); return; }
    void run(event.requestId, event.parameters);
  };
  // Invocations of the id that arrive before native confirms this registration wait for it: when it is refused (for
  // example E_BUSY, because another handler has the id) they belong to that other handler and are dropped.
  let pending: Record<string, unknown>[] | undefined = [];
  const subscription = onDesktopEvent(event => {
    if (stopped) return;
    if (pending) pending.push(event); else deliver(event);
  }, { types: ["appIntentInvoked"], target: { field: "id", value: id } });
  try { await call(spec, "register", { id }, isNull); }
  catch (cause) { stopped = true; pending = undefined; subscription.remove(); throw cause; }
  const waiting = pending;
  pending = undefined;
  waiting.forEach(deliver);
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => { await call(spec, "unregister", { id }, isNull); });
}

/**
 * Tells the system the person just did what the intent does, with these parameters, so Siri and Spotlight can suggest
 * it later (IntentDonationManager). Parameters are checked against the declaration (E_INVALID_ARGUMENT).
 */
export async function donateAppIntent(id: string, parameters: AppIntentParameters = {}): Promise<void> {
  intentId(id);
  if (!isParameters(parameters)) throw new SparkError("E_INVALID_ARGUMENT", "Parameters are an object of strings, finite numbers, booleans or null");
  await call(native(), "donate", { id, parameters }, isNull);
}
