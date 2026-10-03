import Native from "./NativeDesktopNotifications";
import { Platform, TurboModuleRegistry } from "react-native";
import type { Spec as AppSpec } from "@legendapp/spark-desktop-app/src/NativeDesktopApp";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, invokeNative, parseNativeResult, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
export type { Subscription } from "@legendapp/spark-desktop-app/src/contracts";

export interface NotificationPermission {
  status: "undetermined" | "denied" | "granted" | "unknown";
  granted: boolean;
  /** null when the host cannot determine this; Windows has no in-app prompt. */
  canAskAgain: boolean | null;
  macos?: { authorization: "notDetermined" | "denied" | "authorized" | "provisional" | "unknown" };
}
export interface NotificationAction { id: string; label: string }
/** Portable tone names; each target maps them to its own system sounds (documented in the native bridges). */
export type NotificationTone = "message" | "mail" | "reminder" | "call" | "error";
export interface NotificationContent {
  title: string;
  body?: string;
  subtitle?: string;
  /** false/omitted is silent; true or "default" plays the platform default; a tone selects a system sound. */
  sound?: boolean | "default" | NotificationTone;
  /** Custom buttons: 1–4 entries (the portable intersection of macOS categories and Windows toasts). macOS banners show the first two; the rest appear in Notification Center. Tapping the body reports "open", dismissing reports "dismiss". */
  actions?: readonly NotificationAction[];
  data?: Record<string, string>;
}
export interface ShowNotificationOptions { id: string; content: NotificationContent }
export type NotificationTrigger = { type: "delay"; delaySeconds: number };
export interface ScheduleNotificationOptions extends ShowNotificationOptions { trigger: NotificationTrigger }
/** action is "open", "dismiss", or the id of a tapped notification action. */
export interface NotificationResponse { type: "notificationResponse"; id: string; notificationId: string; action: "open" | "dismiss" | (string & {}); data: Record<string, string> }
export function getNotificationAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function native() {
  const availability = getNotificationAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Desktop notifications are unavailable");
  return Native!;
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native().call(method, JSON.stringify(args))), validate);
}
async function command(method: string, args: object = {}): Promise<void> { await call(method, args, (value): value is null => value === null); }
function validId(id: unknown): id is string { return typeof id === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(id); }
function id(value: string): string {
  if (!validId(value)) throw new SparkError("E_INVALID_ARGUMENT", "Notification id must contain 1–100 letters, numbers, dots, underscores or hyphens");
  return value;
}
function options(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected notification options");
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported notification option: ${key}`);
}
function stringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(item => typeof item === "string");
}
const tones = ["message", "mail", "reminder", "call", "error"] as const;
function sound(value: unknown): "none" | "default" | NotificationTone {
  if (value === undefined || value === false) return "none";
  if (value === true || value === "default") return "default";
  if (typeof value === "string" && (tones as readonly string[]).includes(value)) return value as NotificationTone;
  throw new SparkError("E_INVALID_ARGUMENT", "Notification sound must be false, true, \"default\", or a tone name");
}
function actions(value: unknown): NotificationAction[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new SparkError("E_INVALID_ARGUMENT", "Notification actions must contain 1–4 entries");
  return value.map(action => {
    if (!action || typeof action !== "object" || Array.isArray(action) || Object.keys(action).some(key => key !== "id" && key !== "label") || !validId((action as NotificationAction).id) || ["open", "dismiss"].includes((action as NotificationAction).id) || typeof (action as NotificationAction).label !== "string" || !(action as NotificationAction).label.trim() || (action as NotificationAction).label.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Notification actions need an id outside open/dismiss and a label");
    return { id: action.id, label: action.label };
  });
}
function notification(value: ShowNotificationOptions, scheduled: boolean) {
  options(value, scheduled ? ["id", "content", "trigger"] : ["id", "content"]);
  id(value.id); options(value.content, ["title", "body", "subtitle", "sound", "actions", "data"]);
  const content = value.content;
  if (typeof content.title !== "string" || !content.title.trim()) throw new SparkError("E_INVALID_ARGUMENT", "Notification title is required");
  if ([content.body, content.subtitle].some(text => text !== undefined && typeof text !== "string") || (content.data !== undefined && !stringRecord(content.data))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid notification content");
  const result = { id: value.id, title: content.title, body: content.body, subtitle: content.subtitle, data: content.data, sound: sound(content.sound) };
  const actionList = actions(content.actions);
  return actionList === undefined ? result : { ...result, actions: actionList };
}
async function permission(method: string): Promise<NotificationPermission> {
  const value = await call(method, {}, (value): value is NonNullable<NotificationPermission["macos"]>["authorization"] => typeof value === "string" && ["notDetermined", "denied", "authorized", "provisional", "unknown"].includes(value));
  const granted = value === "authorized" || value === "provisional";
  return { status: granted ? "granted" : value === "notDetermined" ? "undetermined" : value as "denied" | "unknown", granted,
    canAskAgain: Platform.OS === "windows" ? false : value === "unknown" ? null : value !== "denied",
    ...(Platform.OS === "macos" ? { macos: { authorization: value } } : {}) };
}
export async function getNotificationPermission(): Promise<NotificationPermission> { return permission("permission"); }
/** Call from an explicit user action. Windows reads OS settings without a prompt. */
export async function requestNotificationPermission(): Promise<NotificationPermission> { return permission("requestPermission"); }
/** Submission accepted by the OS; it does not guarantee presentation. */
export async function showNotification(value: ShowNotificationOptions): Promise<void> { await command("show", notification(value, false)); }
export async function scheduleNotification(value: ScheduleNotificationOptions): Promise<void> {
  const content = notification(value, true);
  options(value.trigger, ["type", "delaySeconds"]);
  if (value.trigger.type !== "delay" || !Number.isFinite(value.trigger.delaySeconds) || value.trigger.delaySeconds < 1 || value.trigger.delaySeconds > 315360000) throw new SparkError("E_INVALID_ARGUMENT", "Notification delay must be 1 second to ten years");
  await command("show", { ...content, delay: value.trigger.delaySeconds });
}
/** Cancels pending delivery only. Missing IDs succeed. */
export async function cancelNotification(value: string): Promise<void> { await command("cancel", { id: id(value) }); }
export async function cancelAllNotifications(): Promise<void> { await command("cancelAll"); }
/** Removes delivered notifications only. Missing IDs succeed. */
export async function dismissNotification(value: string): Promise<void> { await command("dismiss", { id: id(value) }); }
export async function dismissAllNotifications(): Promise<void> { await command("dismissAll"); }
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(validId);
export async function getPendingNotifications(): Promise<string[]> { return call("pending", {}, ids); }
export async function getDeliveredNotifications(): Promise<string[]> { return call("delivered", {}, ids); }
function response(value: unknown): value is NotificationResponse {
  if (!value || typeof value !== "object") return false;
  const event = value as NotificationResponse;
  return event.type === "notificationResponse" && typeof event.id === "string" && event.id.length > 0 && validId(event.notificationId) && validId(event.action) && stringRecord(event.data);
}
/** Subscribe before reading retained cold-launch responses; deduplicate queued/live overlap.
 * Each new subscription replays retained responses (up to 100). Cleanup is synchronous.
 */
export async function onNotificationResponse(listener: (event: NotificationResponse) => void): Promise<Subscription> {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected notification response listener");
  native();
  let removed = false;
  const seen = new Set<string>();
  function receive(event: NotificationResponse) {
    if (removed || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
    listener(event);
  }
  const sub = onDesktopEvent(event => { if (response(event)) receive(event); }, { types: ["notificationResponse"] });
  try {
    const responses = Platform.OS === "windows"
      ? parseNativeResult(await invokeNative(() => {
          const app = TurboModuleRegistry.get<AppSpec>("NativeDesktopApp");
          if (!app) throw new SparkError("E_MODULE_UNAVAILABLE", "Notification activation host is unavailable");
          return app.call("notificationResponses", "{}");
        }), (value): value is NotificationResponse[] => Array.isArray(value) && value.every(response))
      : await call("responses", {}, (value): value is NotificationResponse[] => Array.isArray(value) && value.every(response));
    responses.forEach(receive);
  } catch (error) { removed = true; sub.remove(); throw error; }
  return { remove() { if (!removed) { removed = true; sub.remove(); } } };
}
