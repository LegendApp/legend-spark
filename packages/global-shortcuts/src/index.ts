import { Platform } from "react-native";
import Native from "./NativeDesktopGlobalShortcuts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { parseAccelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
import { SparkError, invokeNative, parseNativeResult, asyncRegistration, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export interface GlobalShortcutOptions {
  /** Fire on keyboard auto-repeat. Windows registers without MOD_NOREPEAT; macOS hotkeys never deliver repeats, so true rejects there. */
  repeat?: boolean;
}
let sequence = 0;
export function getGlobalShortcutAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getGlobalShortcutAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Global shortcuts are unavailable");
  return Native!;
}
async function call(method: string, args: object) {
  parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), (value): value is null => value === null);
}
/** Conflicts/reserved shortcuts reject E_BUSY. Layout is resolved at registration. */
export async function registerGlobalShortcut(accelerator: string, handler: () => void, options: GlobalShortcutOptions = {}): Promise<AsyncRegistration> {
  if (typeof handler !== "function" || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected global shortcut handler and options");
  for (const key of Object.keys(options)) if (!["repeat"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported global shortcut option: ${key}`);
  if (options.repeat !== undefined && typeof options.repeat !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Global shortcut repeat must be boolean");
  if (options.repeat === true && Platform.OS === "macos") throw new SparkError("E_UNSUPPORTED_OPTION", "macOS global shortcuts never deliver keyboard repeats");
  const parsed = parseAccelerator(accelerator, Platform.OS === "windows" ? "windows" : "macos"), id = `global-${Date.now()}-${++sequence}`;
  native();
  let removed = false;
  const subscription = onDesktopEvent(event => { if (!removed && event.type === "globalShortcut" && event.id === id) {
    try { handler(); }
    catch (cause) { console.error(new SparkError("E_NATIVE", "Global shortcut handler failed", { cause })); }
  } }, { types: ["globalShortcut"], target: { field: "id", value: id } });
  try { await call("register", { id, repeat: options.repeat ?? false, ...parsed }); }
  catch (cause) {
    removed = true; subscription.remove();
    try { await call("remove", { id }); }
    catch (cleanup) { throw new SparkError("E_NATIVE", "Shortcut registration and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return asyncRegistration(() => { removed = true; subscription.remove(); }, async () => { await call("remove", { id }); });
}
