import { Platform } from "react-native";
import Native from "./NativeDesktopSystem";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
type SupportedDockLeaf = Exclude<MenuItem, { type: "submenu" | "role" | "slider" }> extends infer Item
  ? Item extends unknown ? Omit<Item, "target" | "placement" | "icon" | "shortcut" | "hidden"> : never
  : never;
export type DockMenuItem = SupportedDockLeaf | (Omit<Extract<MenuItem, { type: "submenu" }>, "items" | "target" | "placement" | "icon" | "shortcut" | "hidden"> & { items: readonly DockMenuItem[] });
type SupportedTaskbarLeaf = Extract<MenuItem, { type: "action" | "checkbox" }> extends infer Item
  ? Item extends unknown ? Omit<Item, "target" | "placement" | "icon" | "shortcut" | "hidden" | "disabled"> & { disabled?: false } : never
  : never;
export type TaskbarMenuItem = SupportedTaskbarLeaf;
type LauncherMenuOptions = { items: readonly MenuItem[]; onAction: (event: { type: "action"; itemId: string }) => void; recentDocuments?: boolean };
export interface DockMenuOptions { items: readonly DockMenuItem[]; onAction: (event: { type: "action"; itemId: string }) => void }
export interface TaskbarMenuOptions {
  items: readonly TaskbarMenuItem[];
  onAction: (event: { type: "action"; itemId: string }) => void;
  /** Adds the Jump List's Recent category: files noted with `noteRecentDocument` whose type is registered to the app. */
  recentDocuments?: boolean;
}
/** Determinate progress has a completed fraction from 0 to 1; paused and error tint the bar. */
export type AppProgress = { state: "indeterminate" } | { state: "normal" | "paused" | "error"; value: number };
export type ThermalState = "nominal" | "fair" | "serious" | "critical";
export interface SystemInfo {
  osVersion: string;
  /** The process architecture. */
  architecture: string;
  /** The process runs under binary translation: Rosetta 2 on macOS, x64 emulation on Windows on Arm. */
  translated: boolean;
  locale: string;
  /** IANA time zone identifier. */
  timeZone: string;
  dark: boolean;
  idleSeconds: number;
  onBattery: boolean;
  batteryLevel: number | null;
  /** Low Power Mode on macOS, battery saver on Windows. */
  lowPowerMode: boolean;
  /** null where the OS has no thermal state (Windows); see getSystemAvailability("thermalState"). */
  thermalState: ThermalState | null;
}
export type NetworkInterfaceType = "wifi" | "wired" | "cellular" | "loopback" | "other";
export interface NetworkStatus {
  /** `requiresConnection`: reachable once a connection such as an on-demand VPN is established. */
  status: "online" | "offline" | "requiresConnection";
  /** Interface types the current path can use. */
  interfaces: NetworkInterfaceType[];
  /** Metered, such as cellular or a personal hotspot. */
  expensive: boolean;
  /** Low Data Mode. */
  constrained: boolean;
  /** System proxies as `host:port`, or the automatic configuration URL; null when off. */
  proxies: { http: string | null; https: string | null; socks: string | null; autoConfigURL: string | null };
}
export type MemoryPressureLevel = "normal" | "warning" | "critical";
/** Invalidations: query getSystemInfo() or getNetworkStatus() again for current values. */
export type SystemEvent =
  | { type: "sleep" | "wake" | "lock" | "unlock" | "sessionActive" | "sessionInactive" | "powerChanged" | "lowPowerChanged" | "thermalChanged"
    | "networkChanged" | "proxyChanged" | "localeChanged" | "timeZoneChanged" | "clockChanged" | "appearanceChanged" | "displaysChanged" }
  | { type: "memoryPressure"; level: MemoryPressureLevel };
/** Capabilities that not every platform has. */
export type SystemFeature = "appBadge" | "appProgress" | "attention" | "dockMenu" | "taskbarMenu" | "thermalState" | "networkStatus" | "memoryPressure" | "lowPowerChanges" | "timeZoneChanges";
export type LoginItemStatus = "enabled" | "disabled" | "requiresApproval" | "notFound" | "unavailable";
export interface AttentionOptions { kind?: "informational" | "critical" }
export interface PreventSleepOptions { reason: string; kind?: "display" | "system" }
let sequence = 0;
const token = () => `system-${Date.now()}-${++sequence}`;
// Windows has no public thermal-state API. Its network status, memory pressure, battery saver and time zone
// notifications are not implemented yet.
const FEATURES: Record<SystemFeature, readonly string[]> = {
  appBadge: ["macos", "windows"], appProgress: ["macos", "windows"], attention: ["macos", "windows"],
  dockMenu: ["macos"], taskbarMenu: ["windows"],
  thermalState: ["macos"], networkStatus: ["macos"], memoryPressure: ["macos"], lowPowerChanges: ["macos"], timeZoneChanges: ["macos"],
};
/** Without a feature, whether the system module is usable at all. */
export function getSystemAvailability(feature?: SystemFeature): Availability {
  if (feature !== undefined && !Object.hasOwn(FEATURES, feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown system feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (feature && !FEATURES[feature].includes(Platform.OS)) return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  const available = getSystemAvailability();
  if (!available.available) throw new SparkError(available.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "System APIs are unavailable");
  return parseNativeResult(await invokeNative(() => Native!.call(method, JSON.stringify(args))), validate);
}
async function command(method: string, args: object = {}): Promise<void> { await call(method, args, (value): value is null => value === null); }
function options(value: object, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected options");
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported system option: ${key}`);
}
const THERMAL_STATES: readonly unknown[] = ["nominal", "fair", "serious", "critical"];
const INTERFACES: readonly unknown[] = ["wifi", "wired", "cellular", "loopback", "other"];
const nullableString = (value: unknown) => value === null || (typeof value === "string" && value.length > 0);
function isInfo(value: unknown): value is SystemInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as SystemInfo;
  return [info.osVersion, info.architecture, info.locale, info.timeZone].every(value => typeof value === "string" && value.length > 0)
    && [info.translated, info.dark, info.onBattery, info.lowPowerMode].every(value => typeof value === "boolean")
    && Number.isFinite(info.idleSeconds) && info.idleSeconds >= 0
    && (info.batteryLevel === null || (typeof info.batteryLevel === "number" && Number.isFinite(info.batteryLevel) && info.batteryLevel >= 0 && info.batteryLevel <= 1))
    && (info.thermalState === null || THERMAL_STATES.includes(info.thermalState));
}
function isNetworkStatus(value: unknown): value is NetworkStatus {
  if (!value || typeof value !== "object") return false;
  const network = value as NetworkStatus, proxies = network.proxies;
  return ["online", "offline", "requiresConnection"].includes(network.status) && Array.isArray(network.interfaces) && network.interfaces.every(type => INTERFACES.includes(type))
    && typeof network.expensive === "boolean" && typeof network.constrained === "boolean"
    && !!proxies && typeof proxies === "object" && [proxies.http, proxies.https, proxies.socks, proxies.autoConfigURL].every(nullableString);
}
export function getSystemInfo(): Promise<SystemInfo> { return call("info", {}, isInfo); }
/** The current network path and system proxies (macOS). */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  const available = getSystemAvailability("networkStatus");
  if (!available.available) throw new SparkError(available.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Network status is unavailable");
  return call("network", {}, isNetworkStatus);
}
export function getLoginItemStatus(): Promise<LoginItemStatus> { return call("loginStatus", {}, (value): value is LoginItemStatus => typeof value === "string" && ["enabled", "disabled", "requiresApproval", "notFound", "unavailable"].includes(value)); }
export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (typeof enabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected enabled boolean");
  await command("login", { enabled });
}
/**
 * Dock badge on macOS, taskbar overlay icon on Windows. A count is formatted natively (macOS uses the
 * user's locale); an empty string or a count of 0 clears it.
 */
export async function setAppBadge(value: string | number): Promise<void> {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new SparkError("E_INVALID_ARGUMENT", "Expected a badge count that is a non-negative integer");
    await command("badge", { count: value });
    return;
  }
  if (typeof value !== "string" || value.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected badge text without NUL");
  await command("badge", { label: value });
}
/** Progress on the Dock tile (macOS) or taskbar button (Windows); null clears it. */
export async function setAppProgress(progress: AppProgress | null): Promise<void> {
  if (progress === null) { await command("progress", { state: "none" }); return; }
  const state = progress?.state;
  if (state === "indeterminate") { options(progress, ["state"]); await command("progress", { state }); return; }
  if (state !== "normal" && state !== "paused" && state !== "error") throw new SparkError("E_INVALID_ARGUMENT", "Unknown progress state");
  options(progress, ["state", "value"]);
  const { value } = progress as { value: unknown };
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) throw new SparkError("E_INVALID_ARGUMENT", "Progress value must be from 0 to 1");
  await command("progress", { state, value });
}
export async function requestAttention(value: AttentionOptions = {}): Promise<AsyncRegistration> {
  options(value, ["kind"]);
  if (value.kind !== undefined && value.kind !== "informational" && value.kind !== "critical") throw new SparkError("E_INVALID_ARGUMENT", "Unknown attention kind");
  // AppKit can return a negative request token when no attention is necessary.
  const id = await call("attention", { critical: value.kind === "critical" }, (value): value is number => typeof value === "number" && Number.isSafeInteger(value));
  return asyncRegistration(() => {}, () => command("cancelAttention", { id }));
}
export async function preventSleep(value: PreventSleepOptions): Promise<AsyncRegistration> {
  options(value, ["reason", "kind"]);
  if (typeof value.reason !== "string" || !value.reason.trim() || value.reason.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "A reason is required");
  if (value.kind !== undefined && value.kind !== "display" && value.kind !== "system") throw new SparkError("E_INVALID_ARGUMENT", "Unknown sleep prevention kind");
  const id = await call("preventSleep", { reason: value.reason, kind: value.kind ?? "display" }, (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return asyncRegistration(() => {}, () => command("allowSleep", { id }));
}
async function createLauncherMenu(value: LauncherMenuOptions, platform: "macos" | "windows"): Promise<AsyncRegistration> {
  if (Platform.OS !== platform) throw new SparkError("E_UNSUPPORTED_PLATFORM", `${platform === "macos" ? "Dock" : "Taskbar"} menus require ${platform}`);
  options(value, platform === "windows" ? ["items", "onAction", "recentDocuments"] : ["items", "onAction"]);
  if (typeof value.onAction !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onAction callback");
  if (value.recentDocuments !== undefined && typeof value.recentDocuments !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected recentDocuments boolean");
  // Jump Lists cannot render native submenus, shortcuts, icons or disabled tasks.
  const items = menuItems(value.items, { types: platform === "macos" ? ["action", "checkbox", "separator", "submenu"] : ["action", "checkbox"] }, platform);
  const ids = selectableMenuIds(items), owner = token(), onAction = value.onAction;
  let stopped = false, ready = false;
  const subscription = onDesktopEvent(event => {
    if (ready && !stopped && event.type === "dockAction" && event.owner === owner && typeof event.id === "string" && ids.has(event.id)) onAction({ type: "action", itemId: event.id });
  }, { types: ["dockAction"], target: { field: "owner", value: owner } });
  try { await command("dockMenu", { items, owner, ...(value.recentDocuments ? { recent: true } : {}) }); ready = true; } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => command("clearDockMenu", { owner }));
}
export function createDockMenu(options: DockMenuOptions): Promise<AsyncRegistration> { return createLauncherMenu(options, "macos"); }
export function createTaskbarMenu(options: TaskbarMenuOptions): Promise<AsyncRegistration> { return createLauncherMenu(options, "windows"); }
const SYSTEM_EVENTS: readonly SystemEvent["type"][] = ["sleep", "wake", "lock", "unlock", "sessionActive", "sessionInactive", "powerChanged", "lowPowerChanged", "thermalChanged",
  "networkChanged", "proxyChanged", "localeChanged", "timeZoneChanged", "clockChanged", "memoryPressure", "appearanceChanged", "displaysChanged"];
export interface SystemEventOptions {
  /** Event types to receive; omitted, every type. Network, proxy and memory pressure observers are installed only for subscriptions that include their events. */
  types?: readonly SystemEvent["type"][];
  /** Receives E_INVALID_DATA for a malformed native event. Without it, the error is rethrown asynchronously. */
  onError?: (error: SparkError) => void;
}
export async function onSystemEvent(handler: (event: SystemEvent) => void, value: SystemEventOptions = {}): Promise<AsyncRegistration> {
  if (typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected system event handler");
  options(value, ["types", "onError"]);
  const types = value.types ?? SYSTEM_EVENTS, onError = value.onError;
  if (!Array.isArray(types) || !types.length || types.some(type => !SYSTEM_EVENTS.includes(type))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a nonempty list of system event types");
  if (onError !== undefined && typeof onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onError callback");
  const id = token(); let stopped = false;
  const subscription = onDesktopEvent(event => {
    if (stopped) return;
    if (event.type !== "memoryPressure") { handler({ type: event.type as Exclude<SystemEvent["type"], "memoryPressure"> }); return; }
    if (event.level === "normal" || event.level === "warning" || event.level === "critical") { handler({ type: "memoryPressure", level: event.level }); return; }
    const error = new SparkError("E_INVALID_DATA", "memoryPressure event without a valid level");
    if (onError) onError(error); else setTimeout(() => { throw error; });
  }, { types: [...new Set(types)] });
  try { await command("observe", { id, types: [...new Set(types)] }); } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => command("unobserve", { id }));
}
