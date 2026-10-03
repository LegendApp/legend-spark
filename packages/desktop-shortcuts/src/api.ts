import { NativeEventEmitter, Platform } from "react-native";
import Native from "./NativeDesktopShortcuts";
import { parseAccelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
import { SparkError, invokeNative, parseNativeResult, asyncRegistration, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export { parseAccelerator, type Accelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
export interface ShortcutOptions { windowId?: string; repeat?: boolean }
export function getShortcutAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getShortcutAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Application shortcuts are unavailable");
  return Native!;
}
async function call(method: string, args: object) {
  parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), (value): value is null => value === null);
}
/** Focused-app shortcuts, consumed before insertion into text fields. Repeat defaults to false. */
export async function registerShortcut(accelerator: string, handler: () => void, options: ShortcutOptions = {}): Promise<AsyncRegistration> {
  if (typeof handler !== "function" || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected shortcut handler and options");
  for (const key of Object.keys(options)) if (!["windowId", "repeat"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported shortcut option: ${key}`);
  if (options.windowId !== undefined && (typeof options.windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid shortcut windowId");
  if (options.repeat !== undefined && typeof options.repeat !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Shortcut repeat must be boolean");
  const parsed = parseAccelerator(accelerator, Platform.OS === "windows" ? "windows" : "macos");
  const id = `shortcut-${Date.now()}-${++nextID}`;
  let removed = false;
  const module = native();
  const subscription = new NativeEventEmitter(module).addListener("shortcut", (event: unknown) => {
    if (!removed && event && typeof event === "object" && (event as { id?: unknown }).id === id) {
      try { handler(); }
      catch (cause) { console.error(new SparkError("E_NATIVE", "Shortcut handler failed", { cause })); }
    }
  });
  try { await call("register", { id, ...parsed, ...options }); }
  catch (cause) {
    removed = true; subscription.remove();
    try { await call("remove", { id }); }
    catch (cleanup) { throw new SparkError("E_NATIVE", "Shortcut registration and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return asyncRegistration(() => { removed = true; subscription.remove(); }, async () => { await call("remove", { id }); });
}
let nextID = 0;
