import { NativeEventEmitter, Platform } from "react-native";
import Native from "./NativeKeyboardManager";
import { SparkError, asyncRegistration, invokeNative, type AsyncRegistration, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
export { KeyCodes, KeyText } from "./codes";
export type KeyboardEvent = Readonly<{ eventId: string; windowId: string | null; key: string; keyCode: number; modifiers: number }>;
export type KeyboardEventListener = (event: KeyboardEvent) => boolean | void;
export type KeyboardListenerOptions = { windowIds?: readonly string[] };
type Entry = { type: "down" | "up"; listener: KeyboardEventListener; windowIds?: readonly string[] };
const entries = new Set<Entry>();
let subscriptions: Subscription[] = [], monitoring = false, transitions = Promise.resolve();
export function getKeyboardAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getKeyboardAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Low-level keyboard monitoring requires a macOS host");
  return Native!;
}
function notify(type: Entry["type"], value: unknown) {
  if (!value || typeof value !== "object") return;
  const event = value as KeyboardEvent;
  let handled = false;
  try {
    if (typeof event.eventId !== "string" || typeof event.key !== "string" || !Number.isInteger(event.keyCode) || !Number.isInteger(event.modifiers) || !(event.windowId === null || typeof event.windowId === "string")) return;
    for (const entry of entries) if (entry.type === type && (!entry.windowIds || (event.windowId !== null && entry.windowIds.includes(event.windowId)))) handled = entry.listener(event) === true || handled;
  } finally { if (typeof event.eventId === "string") Native?.respondToKeyEvent(event.eventId, handled); }
}
function synchronize(): Promise<void> {
  const pending = transitions.then(async () => {
    if (entries.size && !monitoring) {
      const module = native(), emitter = new NativeEventEmitter(module);
      subscriptions = [emitter.addListener("onKeyDown", event => notify("down", event)), emitter.addListener("onKeyUp", event => notify("up", event))];
      try {
        const started = await invokeNative(() => module.startMonitoringKeyboard());
        if (started !== true) throw new SparkError("E_INVALID_DATA", "Keyboard monitor did not start");
        monitoring = true;
      } catch (error) { for (const subscription of subscriptions) subscription.remove(); subscriptions = []; throw error; }
    } else if (!entries.size && monitoring) {
      const stopped = await invokeNative(() => native().stopMonitoringKeyboard());
      if (stopped !== true) throw new SparkError("E_INVALID_DATA", "Keyboard monitor did not stop");
      monitoring = false;
      for (const subscription of subscriptions) subscription.remove(); subscriptions = [];
    }
  });
  transitions = pending.catch(() => {}); return pending;
}
/** App-scoped macOS physical events. Consumption must be decided synchronously. */
export async function addKeyboardListener(type: "down" | "up", listener: KeyboardEventListener, options: KeyboardListenerOptions = {}): Promise<AsyncRegistration> {
  if ((type !== "down" && type !== "up") || typeof listener !== "function" || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected keyboard event type, listener and options");
  for (const key of Object.keys(options)) if (key !== "windowIds") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown keyboard option: ${key}`);
  if (options.windowIds !== undefined && (!Array.isArray(options.windowIds) || options.windowIds.some(id => typeof id !== "string" || !id))) throw new SparkError("E_INVALID_ARGUMENT", "Expected window IDs");
  native();
  const entry = { type, listener, windowIds: options.windowIds ? [...options.windowIds] : undefined };
  entries.add(entry);
  try { await synchronize(); } catch (error) { entries.delete(entry); throw error; }
  return asyncRegistration(() => { entries.delete(entry); }, synchronize);
}
export function hasModifier(event: Pick<KeyboardEvent, "modifiers">, modifier: number): boolean { return (event.modifiers & modifier) === modifier; }
export function createModifierMask(...modifiers: number[]): number { return modifiers.reduce((mask, modifier) => mask | modifier, 0); }
