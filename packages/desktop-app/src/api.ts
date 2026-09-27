import { Platform, TurboModuleRegistry } from "react-native";
import { onDesktopEvent, type DesktopEvent } from "./events";
import { callAppNative } from "./transport";
import { SparkError, asyncRegistration, nativeError, type Availability, type AsyncRegistration, type Subscription } from "./contracts";
export interface AppRuntime { mode: "go" | "dev" | "preview" | "release"; modules: Readonly<Record<string, string>> }
export interface AppContext { projectId: string; name: string; version: string; runtime: AppRuntime; launchArguments: readonly string[] }
export type QuitResult = { quitRequested: true } | { quitRequested: false; reason: "vetoed" };
export type AppEventMap = {
  windowOpened: { type: "windowOpened"; windowId: string };
  windowClosed: { type: "windowClosed"; windowId: string };
  activate: { type: "activate" };
  deactivate: { type: "deactivate" };
  reopen: { type: "reopen"; hasVisibleWindows: boolean; mainWindowWasVisible: boolean };
  secondInstance: { type: "secondInstance"; arguments: readonly string[] };
  willQuit: { type: "willQuit" };
};
export type AppEvent = AppEventMap[keyof AppEventMap];
export interface BeforeQuitOptions { onError?: (error: Error) => void }
export function getAppAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return TurboModuleRegistry.get("NativeDesktopApp") ? { available: true } : { available: false, reason: "missing-module" };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === "string"); }
function context(value: unknown): value is AppContext {
  if (!record(value) || ![value.projectId, value.name, value.version].every(item => typeof item === "string" && item.length > 0) || !strings(value.launchArguments) || !record(value.runtime)) return false;
  return ["go", "dev", "preview", "release"].includes(value.runtime.mode as string) && record(value.runtime.modules) && Object.values(value.runtime.modules).every(item => typeof item === "string");
}
export async function getAppContext(): Promise<AppContext> {
  const value = await callAppNative("context", context);
  return { projectId: value.projectId, name: value.name, version: value.version, launchArguments: [...value.launchArguments], runtime: { mode: value.runtime.mode, modules: { ...value.runtime.modules } } };
}
const command = (method: string, args: object = {}) => callAppNative(method, (value): value is null => value === null, args).then(() => {});
const orphanGuards = new Set<AsyncRegistration>();
async function cleanOrphanGuards(): Promise<void> {
  await Promise.all([...orphanGuards].map(async guard => { await guard.remove(); orphanGuards.delete(guard); }));
}
let quitting: Promise<QuitResult> | undefined;
/** Joins an existing quit decision. Success permits shutdown; it is not an after-exit hook. */
export function quit(): Promise<QuitResult> {
  return quitting ??= cleanOrphanGuards().then(() => callAppNative("quit", (value): value is QuitResult => record(value) && (value.quitRequested === true || (value.quitRequested === false && value.reason === "vetoed")))).finally(() => { quitting = undefined; });
}
export const hide = (): Promise<void> => command("hide");
export const activate = (): Promise<void> => command("activate");
function appEvent(value: DesktopEvent): AppEvent | undefined {
  switch (value.type) {
    case "opened": case "closed": if (typeof value.windowId === "string" && value.windowId) return { type: value.type === "opened" ? "windowOpened" : "windowClosed", windowId: value.windowId }; break;
    case "activate": case "deactivate": case "willQuit": return { type: value.type };
    case "reopen": if (typeof value.hasVisibleWindows === "boolean" && typeof value.mainWindowWasVisible === "boolean") return { type: "reopen", hasVisibleWindows: value.hasVisibleWindows, mainWindowWasVisible: value.mainWindowWasVisible }; break;
    case "secondInstance": if (strings(value.arguments)) return { type: "secondInstance", arguments: [...value.arguments] }; break;
  }
}
/** Live events only. Initial identity is getAppContext; file/URL replay belongs to documents. */
export function addAppListener<K extends keyof AppEventMap>(type: K, listener: (event: AppEventMap[K]) => void): Subscription {
  if (!["activate", "deactivate", "reopen", "secondInstance", "willQuit", "windowOpened", "windowClosed"].includes(type) || typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an application event and listener");
  const availability = getAppAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Application events are unavailable");
  return onDesktopEvent(value => { const event = appEvent(value); if (event?.type === type) listener(event as AppEventMap[K]); });
}
let nextGuard = 0;
/** All registered guards must approve. Rejection, removal or the native 30s deadline vetoes. */
export async function beforeQuit(handler: () => boolean | Promise<boolean>, options: BeforeQuitOptions = {}): Promise<AsyncRegistration> {
  if (typeof handler !== "function" || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a quit handler and options");
  for (const key of Object.keys(options)) if (key !== "onError") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown quit-guard option: ${key}`);
  if (options.onError !== undefined && typeof options.onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an error callback");
  const availability = getAppAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Quit guards are unavailable");
  await cleanOrphanGuards();
  const id = `quit-${Date.now()}-${++nextGuard}-${Math.random().toString(36).slice(2)}`;
  let removed = false, latestRequest = 0;
  const onError = options.onError ?? console.error;
  const reportError = (cause: unknown) => { if (!removed) { try { onError(nativeError(cause)); } catch (error) { console.error(error); } } };
  const subscription = onDesktopEvent(event => {
    if (removed || event.type !== "beforeQuit" || event.guardId !== id || !Number.isSafeInteger(event.requestId) || (event.requestId as number) <= latestRequest) return;
    const requestId = latestRequest = event.requestId as number;
    void Promise.resolve().then(() => removed ? false : handler()).catch(error => { reportError(error); return false; }).then(
      allow => command("replyQuit", { id, allow: !removed && latestRequest === requestId && allow === true, requestId }),
    ).catch(error => { reportError(error); });
  });
  const registration = asyncRegistration(() => { removed = true; subscription.remove(); }, () => command("quitGuard", { id, enabled: false }));
  try { await command("quitGuard", { id, enabled: true }); }
  catch (cause) {
    try { await registration.remove(); } catch (cleanup) { orphanGuards.add(registration); throw new SparkError("E_NATIVE", "Quit guard registration and cleanup failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
  return registration;
}
