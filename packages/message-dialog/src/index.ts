import { Platform } from "react-native";
import { SparkError, parseNativeResult, invokeNative, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import Native from "./NativeDesktopMessageDialog";
export interface MessageDialogButton { id: string; label: string }
export interface MessageDialogOptions {
  title: string;
  message?: string;
  kind?: "info" | "warning" | "error";
  buttons?: readonly MessageDialogButton[];
  defaultButtonId?: string;
  cancelButtonId?: string;
  windowId?: string;
  checkbox?: { label: string; checked?: boolean };
}
export interface MessageDialogResult {
  /** null means the host dismissed the dialog without selecting a button. */
  buttonId: string | null;
  checked: boolean;
}
export interface ConfirmOptions { title?: string; windowId?: string }
export function getMessageDialogAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
export async function showMessage(options: MessageDialogOptions): Promise<MessageDialogResult> {
  if (!options || typeof options !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected message dialog options");
  for (const key of Object.keys(options)) if (!["title", "message", "kind", "buttons", "defaultButtonId", "cancelButtonId", "windowId", "checkbox"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported dialog option: ${key}`);
  const buttons = options.buttons ?? [{ id: "ok", label: "OK" }];
  const validString = (value: unknown): value is string => typeof value === "string" && !!value && !value.includes("\0");
  if (!validString(options.title) || !Array.isArray(buttons) || !buttons.length || buttons.length > 4 || buttons.some(value => !value || !validString(value.id) || !validString(value.label))) throw new SparkError("E_INVALID_ARGUMENT", "Dialog needs a title and 1–4 buttons with IDs and labels");
  const ids = buttons.map(button => button.id);
  if (new Set(ids).size !== ids.length) throw new SparkError("E_INVALID_ARGUMENT", "Dialog button IDs must be unique");
  for (const id of [options.defaultButtonId, options.cancelButtonId]) if (id !== undefined && !ids.includes(id)) throw new SparkError("E_INVALID_ARGUMENT", "Dialog button ID must identify a button");
  if (options.kind !== undefined && !["info", "warning", "error"].includes(options.kind)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid dialog kind");
  if (options.windowId !== undefined && !validString(options.windowId)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid owner window ID");
  if (options.message !== undefined && typeof options.message !== "string") throw new SparkError("E_INVALID_ARGUMENT", "message must be a string");
  if (options.checkbox !== undefined && (!options.checkbox || !validString(options.checkbox.label) || (options.checkbox.checked !== undefined && typeof options.checkbox.checked !== "boolean"))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid checkbox options");
  const availability = getMessageDialogAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Message dialogs require a desktop host with NativeDesktopMessageDialog installed");
  const { defaultButtonId, cancelButtonId, ...rest } = options;
  const result = parseNativeResult(await invokeNative(() => Native!.call("show", JSON.stringify({ ...rest, buttons: buttons.map(button => button.label), defaultButton: defaultButtonId === undefined ? 0 : ids.indexOf(defaultButtonId), cancelButton: cancelButtonId === undefined ? undefined : ids.indexOf(cancelButtonId) }))), (value): value is { button: number; checked: boolean } => !!value && typeof value === "object" && "button" in value && Number.isInteger(value.button) && (value.button as number) >= -1 && (value.button as number) < buttons.length && "checked" in value && typeof value.checked === "boolean");
  return { buttonId: result.button === -1 ? null : ids[result.button], checked: result.checked };
}
export async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const result = await showMessage({ title: options.title ?? "Confirm", message, windowId: options.windowId, buttons: [{ id: "cancel", label: "Cancel" }, { id: "continue", label: "Continue" }], defaultButtonId: "continue", cancelButtonId: "cancel" });
  return result.buttonId === "continue";
}
