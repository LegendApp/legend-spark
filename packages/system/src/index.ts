import { Platform } from "react-native";
import Native from "./NativeDesktopSystem";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
export type { MenuItem, MenuAction } from "@legendapp/spark-desktop-app/src/contracts/menu";
export interface SystemInfo { osVersion: string; architecture: string; locale: string; dark: boolean; idleSeconds: number; onBattery: boolean; batteryLevel: number | null }
export type SystemEvent = { type: "sleep" | "wake" | "lock" | "unlock" | "powerChanged" | "appearanceChanged" | "displaysChanged" };
export type LoginItemStatus = "enabled" | "disabled" | "requiresApproval" | "notFound" | "unavailable";
export interface AttentionOptions { kind?: "informational" | "critical" }
export interface PreventSleepOptions { reason: string; kind?: "display" | "system" }
export interface LauncherMenuOptions { items: readonly MenuItem[]; onAction: (event: { type: "action"; itemId: string }) => void }
let sequence = 0;
const token = () => `system-${Date.now()}-${++sequence}`;
export function getSystemAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
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
function isInfo(value: unknown): value is SystemInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as SystemInfo;
  return [info.osVersion, info.architecture, info.locale].every(value => typeof value === "string" && value.length > 0) && typeof info.dark === "boolean" && typeof info.onBattery === "boolean" && Number.isFinite(info.idleSeconds) && info.idleSeconds >= 0 && (info.batteryLevel === null || (typeof info.batteryLevel === "number" && Number.isFinite(info.batteryLevel) && info.batteryLevel >= 0 && info.batteryLevel <= 1));
}
export function getSystemInfo(): Promise<SystemInfo> { return call("info", {}, isInfo); }
export function getLoginItemStatus(): Promise<LoginItemStatus> { return call("loginStatus", {}, (value): value is LoginItemStatus => typeof value === "string" && ["enabled", "disabled", "requiresApproval", "notFound", "unavailable"].includes(value)); }
export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (typeof enabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected enabled boolean");
  await command("login", { enabled });
}
/** Dock badge on macOS, taskbar overlay on Windows; empty string clears it. */
export async function setAppBadge(label: string): Promise<void> {
  if (typeof label !== "string" || label.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected badge text without NUL");
  await command("badge", { label });
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
  options(value, ["items", "onAction"]);
  if (typeof value.onAction !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onAction callback");
  // Jump Lists cannot render native submenus, shortcuts, icons or disabled tasks.
  const items = menuItems(value.items, { types: platform === "macos" ? ["action", "checkbox", "separator", "submenu"] : ["action", "checkbox"] }, platform);
  const ids = selectableMenuIds(items), owner = token(), onAction = value.onAction;
  let stopped = false, ready = false;
  const subscription = onDesktopEvent(event => {
    if (ready && !stopped && event.type === "dockAction" && event.owner === owner && typeof event.id === "string" && ids.has(event.id)) onAction({ type: "action", itemId: event.id });
  }, { types: ["dockAction"], target: { field: "owner", value: owner } });
  try { await command("dockMenu", { items, owner }); ready = true; } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => command("clearDockMenu", { owner }));
}
export function createDockMenu(options: LauncherMenuOptions): Promise<AsyncRegistration> { return createLauncherMenu(options, "macos"); }
export function createTaskbarMenu(options: LauncherMenuOptions): Promise<AsyncRegistration> { return createLauncherMenu(options, "windows"); }
export async function onSystemEvent(handler: (event: SystemEvent) => void): Promise<AsyncRegistration> {
  if (typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected system event handler");
  const types: readonly SystemEvent["type"][] = ["sleep", "wake", "lock", "unlock", "powerChanged", "appearanceChanged", "displaysChanged"];
  const id = token(); let stopped = false;
  const subscription = onDesktopEvent(event => { if (!stopped && types.includes(event.type as SystemEvent["type"])) handler({ type: event.type as SystemEvent["type"] }); }, { types });
  try { await command("observe", { id }); } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => command("unobserve", { id }));
}
