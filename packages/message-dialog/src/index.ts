import { Platform } from "react-native";
import { SparkError, parseNativeResult, invokeNative, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import { frameworkStrings } from "@legendapp/spark-desktop-app/src/framework-strings";
import Native from "./NativeDesktopMessageDialog";
/** A button in `showMessage`: `id` is returned when it is chosen, `label` is shown. IDs must be unique. */
export interface MessageDialogButton { id: string; label: string }
/** Options for `showMessage`. `title` is required; 1-4 buttons; `defaultButtonId` (default: the first button) and `cancelButtonId` must name a button; `windowId` names the owner window. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface MessageDialogOptions {
  title: string;
  message?: string;
  kind?: "info" | "warning" | "error";
  /** Defaults to one "ok" button labelled OK in the app's language. */
  buttons?: readonly MessageDialogButton[];
  defaultButtonId?: string;
  cancelButtonId?: string;
  windowId?: string;
  /** A "Don't ask again" style checkbox. Its final state returns as `checked`; persisting it is the caller's choice. */
  checkbox?: { label: string; checked?: boolean };
}
/** Result of `showMessage`. */
export interface MessageDialogResult {
  /** null means the host dismissed the dialog without selecting a button. */
  buttonId: string | null;
  /** The checkbox's final state; present only when options.checkbox was supplied. */
  checked?: boolean;
}
/** Options for `confirm`. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface ConfirmOptions {
  /** Defaults to Confirm in the app's language. */
  title?: string;
  windowId?: string;
  /** Defaults to Continue in the app's language. */
  confirmLabel?: string;
  /** Defaults to Cancel in the app's language. */
  cancelLabel?: string;
}
/** Options for `showPrompt`. `title` is required; `windowId` names the owner window. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  /** Initial text, selected when the dialog opens. */
  defaultValue?: string;
  /** Masks the text and keeps it out of the clipboard (NSSecureTextField). */
  secure?: boolean;
  /** Defaults to OK in the app's language. */
  confirmLabel?: string;
  /** Defaults to Cancel in the app's language. */
  cancelLabel?: string;
  windowId?: string;
}
/** Cancel, Escape and host dismissal all resolve `{ canceled: true }`; an empty confirmed value is `""`. */
export type PromptResult = { canceled: true } | { canceled: false; value: string };
/** Overrides for the standard About panel. Omitted fields use the app bundle's values. */
export interface AboutPanelOptions {
  name?: string;
  /** The marketing version, shown as "Version <version>". */
  version?: string;
  /** The build, shown in parentheses after the version. */
  build?: string;
  /** Plain text shown in the scrolling credits area. */
  credits?: string;
  copyright?: string;
  /** Absolute path of an image file (PNG, ICNS, …) shown instead of the app icon. */
  iconPath?: string;
}
/** Features beyond plain message dialogs, for `getMessageDialogAvailability(feature)`. */
export type MessageDialogFeature = "checkbox" | "prompt" | "aboutPanel";
const FEATURES: readonly MessageDialogFeature[] = ["checkbox", "prompt", "aboutPanel"];

/** Without a feature, reports message dialogs. Windows supports the checkbox; prompts and the About panel are macOS-only. */
export function getMessageDialogAvailability(feature?: MessageDialogFeature): Availability {
  if (feature !== undefined && !FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown message dialog feature");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (Platform.OS === "windows" && (feature === "prompt" || feature === "aboutPanel")) return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(feature?: MessageDialogFeature) {
  const availability = getMessageDialogAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${feature === "aboutPanel" ? "The About panel" : feature === "prompt" ? "Text prompts" : "Message dialogs"} require ${feature ? "macOS" : "a desktop host"} with NativeDesktopMessageDialog installed`);
}
const validString = (value: unknown): value is string => typeof value === "string" && !!value && !value.includes("\0");
function knownKeys(options: object, allowed: readonly string[], what: string) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${what} options`);
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${what} option: ${key}`);
}
function optionalString(options: Record<string, unknown>, keys: readonly string[], allowEmpty = false) {
  for (const key of keys) {
    const value = options[key];
    if (value !== undefined && (typeof value !== "string" || value.includes("\0") || (!allowEmpty && !value))) throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a ${allowEmpty ? "" : "non-empty "}string without NUL characters`);
  }
}
function validWindowId(windowId: unknown) {
  if (windowId !== undefined && (typeof windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid owner window ID");
}

/** The caller's labels, with Spark's own label in the app's language for each one omitted. */
async function withDefaults(...labels: readonly [string | undefined, "OK" | "Cancel" | "Continue" | "Confirm"][]): Promise<string[]> {
  const missing = labels.filter(([label]) => label === undefined).map(([, key]) => key);
  const strings: Partial<Record<string, string>> = missing.length ? await frameworkStrings(missing) : {};
  return labels.map(([label, key]) => label ?? strings[key]!);
}

type NativeAlertResult = { button: number; checked: boolean; value?: string };
async function showAlert(wire: Record<string, unknown>, buttonCount: number, input: boolean): Promise<NativeAlertResult> {
  return parseNativeResult(await invokeNative(() => Native!.call("show", JSON.stringify(wire))), (value): value is NativeAlertResult => {
    if (!value || typeof value !== "object") return false;
    const result = value as Record<string, unknown>;
    return Number.isInteger(result.button) && (result.button as number) >= -1 && (result.button as number) < buttonCount && typeof result.checked === "boolean" && (input ? typeof result.value === "string" : !("value" in result));
  });
}

/** Shows a modal message dialog and resolves the chosen button's id. Rejects E_INVALID_ARGUMENT for bad options and E_UNSUPPORTED_PLATFORM off macOS and Windows. */
export async function showMessage(options: MessageDialogOptions): Promise<MessageDialogResult> {
  knownKeys(options, ["title", "message", "kind", "buttons", "defaultButtonId", "cancelButtonId", "windowId", "checkbox"], "dialog");
  const buttons = options.buttons ?? [{ id: "ok", label: "OK" }];
  if (!validString(options.title) || !Array.isArray(buttons) || !buttons.length || buttons.length > 4 || buttons.some(value => !value || !validString(value.id) || !validString(value.label))) throw new SparkError("E_INVALID_ARGUMENT", "Dialog needs a title and 1–4 buttons with IDs and labels");
  const ids = buttons.map(button => button.id);
  if (new Set(ids).size !== ids.length) throw new SparkError("E_INVALID_ARGUMENT", "Dialog button IDs must be unique");
  for (const id of [options.defaultButtonId, options.cancelButtonId]) if (id !== undefined && !ids.includes(id)) throw new SparkError("E_INVALID_ARGUMENT", "Dialog button ID must identify a button");
  if (options.kind !== undefined && !["info", "warning", "error"].includes(options.kind)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid dialog kind");
  validWindowId(options.windowId);
  if (options.message !== undefined && typeof options.message !== "string") throw new SparkError("E_INVALID_ARGUMENT", "message must be a string");
  if (options.checkbox !== undefined && (!options.checkbox || typeof options.checkbox !== "object" || Object.keys(options.checkbox).some(key => key !== "label" && key !== "checked") || !validString(options.checkbox.label) || (options.checkbox.checked !== undefined && typeof options.checkbox.checked !== "boolean"))) throw new SparkError("E_INVALID_ARGUMENT", "Invalid checkbox options");
  requireAvailable(options.checkbox ? "checkbox" : undefined);
  const { defaultButtonId, cancelButtonId, ...rest } = options;
  const labels = options.buttons ? buttons.map(button => button.label) : await withDefaults([undefined, "OK"]);
  const result = await showAlert({ ...rest, buttons: labels, defaultButton: defaultButtonId === undefined ? 0 : ids.indexOf(defaultButtonId), cancelButton: cancelButtonId === undefined ? undefined : ids.indexOf(cancelButtonId) }, buttons.length, false);
  return { buttonId: result.button === -1 ? null : ids[result.button]!, ...(options.checkbox ? { checked: result.checked } : {}) };
}

/** Shows a Cancel / Continue dialog with `message` and resolves true when Continue is chosen. Rejects E_UNSUPPORTED_PLATFORM off macOS and Windows. */
export async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  knownKeys(options, ["title", "windowId", "confirmLabel", "cancelLabel"], "confirmation");
  requireAvailable();
  const [title, cancel, confirmLabel] = await withDefaults([options.title, "Confirm"], [options.cancelLabel, "Cancel"], [options.confirmLabel, "Continue"]);
  const result = await showMessage({ title: title!, message, windowId: options.windowId, buttons: [{ id: "cancel", label: cancel! }, { id: "continue", label: confirmLabel! }], defaultButtonId: "continue", cancelButtonId: "cancel" });
  return result.buttonId === "continue";
}

/** A message dialog with one text field. Return confirms; Escape cancels. */
export async function showPrompt(options: PromptOptions): Promise<PromptResult> {
  knownKeys(options, ["title", "message", "placeholder", "defaultValue", "secure", "confirmLabel", "cancelLabel", "windowId"], "prompt");
  if (!validString(options.title)) throw new SparkError("E_INVALID_ARGUMENT", "Prompt needs a title");
  optionalString(options as unknown as Record<string, unknown>, ["placeholder", "confirmLabel", "cancelLabel"]);
  optionalString(options as unknown as Record<string, unknown>, ["message", "defaultValue"], true);
  if (options.secure !== undefined && typeof options.secure !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "secure must be boolean");
  validWindowId(options.windowId);
  requireAvailable("prompt");
  const buttons = await withDefaults([options.confirmLabel, "OK"], [options.cancelLabel, "Cancel"]);
  const result = await showAlert({
    title: options.title, message: options.message, windowId: options.windowId,
    buttons, defaultButton: 0, cancelButton: 1,
    input: { placeholder: options.placeholder, defaultValue: options.defaultValue ?? "", secure: options.secure ?? false },
  }, 2, true);
  return result.button === 0 ? { canceled: false, value: result.value! } : { canceled: true };
}

/** Shows the standard About panel (macOS `orderFrontStandardAboutPanelWithOptions:`). It is not modal; the promise resolves once it is shown. */
export async function showAboutPanel(options: AboutPanelOptions = {}): Promise<void> {
  knownKeys(options, ["name", "version", "build", "credits", "copyright", "iconPath"], "About panel");
  optionalString(options as unknown as Record<string, unknown>, ["name", "version", "build", "credits", "copyright", "iconPath"]);
  const wire = { ...options, iconPath: options.iconPath === undefined ? undefined : nativePath(options.iconPath, Platform.OS) };
  requireAvailable("aboutPanel");
  parseNativeResult(await invokeNative(() => Native!.call("about", JSON.stringify(wire))), (value): value is null => value === null);
}
