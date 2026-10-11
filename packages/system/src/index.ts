import { Platform } from "react-native";
import Native from "./NativeDesktopSystem";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems, selectableMenuIds, type MenuItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
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
/** Windows thumbnail toolbar button. `icon` is an absolute path to an .ico or .png file. */
export interface ThumbnailToolbarButton { id: string; tooltip: string; icon: string; disabled?: boolean }
export interface ThumbnailToolbarOptions { buttons: readonly ThumbnailToolbarButton[]; onAction: (event: { type: "action"; itemId: string }) => void }
/** Determinate progress has a completed fraction from 0 to 1; paused and error tint the bar. */
export type AppProgress = { state: "indeterminate" } | { state: "normal" | "paused" | "error"; value: number };
export type SystemFeature = "appBadge" | "appProgress" | "attention" | "dockMenu" | "taskbarMenu" | "thumbnailToolbar";
export interface SystemInfo { osVersion: string; architecture: string; locale: string; dark: boolean; idleSeconds: number; onBattery: boolean; batteryLevel: number | null }
export type SystemEvent = { type: "sleep" | "wake" | "lock" | "unlock" | "powerChanged" | "appearanceChanged" | "displaysChanged" };
export type LoginItemStatus = "enabled" | "disabled" | "requiresApproval" | "notFound" | "unavailable";
export interface AttentionOptions { kind?: "informational" | "critical" }
export interface PreventSleepOptions { reason: string; kind?: "display" | "system" }
let sequence = 0;
const token = () => `system-${Date.now()}-${++sequence}`;
// The thumbnail toolbar is Windows-only and not implemented there yet (#301).
const FEATURES: Record<SystemFeature, readonly string[]> = {
  appBadge: ["macos", "windows"], appProgress: ["macos", "windows"], attention: ["macos", "windows"],
  dockMenu: ["macos"], taskbarMenu: ["windows"], thumbnailToolbar: [],
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
/** Up to seven buttons under the taskbar thumbnail of the main window (Windows). */
export async function createThumbnailToolbar(value: ThumbnailToolbarOptions): Promise<AsyncRegistration> {
  options(value, ["buttons", "onAction"]);
  if (typeof value.onAction !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onAction callback");
  if (!Array.isArray(value.buttons) || value.buttons.length < 1 || value.buttons.length > 7) throw new SparkError("E_INVALID_ARGUMENT", "A thumbnail toolbar has one to seven buttons");
  const ids = new Set<string>();
  for (const button of value.buttons) {
    options(button, ["id", "tooltip", "icon", "disabled"]);
    if (typeof button.id !== "string" || !button.id || button.id.includes("\0") || ids.has(button.id)) throw new SparkError("E_INVALID_ARGUMENT", "Button ids must be nonempty and unique");
    ids.add(button.id);
    // THUMBBUTTON.szTip holds 259 characters.
    if (typeof button.tooltip !== "string" || !button.tooltip.trim() || button.tooltip.length > 259 || button.tooltip.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Buttons need a tooltip of at most 259 characters");
    nativePath(button.icon, Platform.OS);
    if (button.disabled !== undefined && typeof button.disabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected disabled boolean");
  }
  // FEATURES.thumbnailToolbar lists no platform until the Windows implementation (#301).
  throw new SparkError("E_UNSUPPORTED_PLATFORM", `The thumbnail toolbar is unavailable on ${Platform.OS}`);
}
export async function onSystemEvent(handler: (event: SystemEvent) => void): Promise<AsyncRegistration> {
  if (typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected system event handler");
  const types: readonly SystemEvent["type"][] = ["sleep", "wake", "lock", "unlock", "powerChanged", "appearanceChanged", "displaysChanged"];
  const id = token(); let stopped = false;
  const subscription = onDesktopEvent(event => { if (!stopped && types.includes(event.type as SystemEvent["type"])) handler({ type: event.type as SystemEvent["type"] }); }, { types });
  try { await command("observe", { id }); } catch (error) { subscription.remove(); throw error; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => command("unobserve", { id }));
}
