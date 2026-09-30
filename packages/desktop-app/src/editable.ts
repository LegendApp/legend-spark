import { NativeEventEmitter, Platform, TurboModuleRegistry } from "react-native";
import type { Spec } from "./NativeDesktopApp";

export type EditingProvider =
  | { kind: "cli"; tool: "codex" | "claude"; model?: string }
  | { kind: "local"; endpoint: string; model: string }
  | { kind: "remote"; endpoint: string; model: string; apiKey?: string };
export type EditingPhase = "idle" | "preparing" | "generating" | "migrating" | "previewing" | "applying" | "error";
export type EditingState = {
  enabled: boolean;
  busy: boolean;
  phase: EditingPhase;
  message: string;
  ready: boolean;
  customized: boolean;
  previewing: boolean;
  migrationAvailable: boolean;
  provider?: Exclude<EditingProvider, { kind: "remote" }> | { kind: "remote"; endpoint: string; model: string };
};
export type EditingPromptOptions = {
  provider?: EditingProvider;
  /** Required for CLI and remote providers. Explain what source/context is shared. */
  allowSourceSharing?: boolean;
  migration?: boolean;
};
export type EditingResult = { candidate: string; summary: string; changedFiles: string[]; status: "needs-review" };
export type EditingPrompt = { id?: string; prompt: string; baseRelease?: string; created?: string; model?: string; provider?: string; providerKind?: "cli" | "local" | "remote"; status?: string; summary?: string; error?: string };
export type EditingReview = { text: string; prompts: EditingPrompt[]; candidate?: string };
export type EditingMigrationResult = { candidate?: string; from?: string; conflicts: string[]; status: "none" | "needs-review" };
export type EditingSubscription = { remove(): void };

const disabled: EditingState = { enabled: false, busy: false, phase: "idle", message: "Editing is not enabled in this app", ready: false, customized: false, previewing: false, migrationAvailable: false };
function native() {
  return Platform.OS === "macos" ? TurboModuleRegistry.get<Spec>("NativeDesktopApp") : null;
}
async function call<T>(method: string, args: object = {}): Promise<T> {
  const module = native();
  if (!module) throw Object.assign(new Error("Editing requires a Spark macOS app"), { code: "E_UNAVAILABLE" });
  return JSON.parse(await module.call(`editable.${method}`, JSON.stringify(args))) as T;
}
/** Availability is safe on unsupported platforms and in apps that did not opt in. */
export async function getEditingState(): Promise<EditingState> {
  return native() ? call<EditingState>("state") : { ...disabled };
}
/** Opens Spark's built-in editor, including when automatic entry points are disabled. */
export const showEditor = (): Promise<void> => call("show");
/** Saves provider settings; remote keys go to Keychain and are never returned in state. */
export const configureEditing = (provider: EditingProvider): Promise<void> => call("configure", { provider });
export const generateEdit = (prompt: string, options: EditingPromptOptions = {}): Promise<EditingResult> => call("prompt", { prompt, ...options });
export const getEditReview = (): Promise<EditingReview> => call("review");
/** Performs a three-way merge; conflicts can be resolved with generateEdit(..., { migration: true }). */
export const prepareEditMigration = (): Promise<EditingMigrationResult> => call("migrate");
/** Reloads the current app/data with the candidate for this session. */
export const previewEdit = (): Promise<void> => call("preview");
/** Accepts the candidate and reloads. The app owns its confirmation/save-work UI. */
export const applyEdit = (): Promise<void> => call("apply");
export const restoreOriginal = (): Promise<void> => call("original");
/** Stops current editing work. Partial candidates and prompt history are retained. */
export const cancelEdit = (): Promise<void> => call("cancel");
/** Live events only: subscribe before requesting getEditingState() for an initial snapshot. */
export function onEditingState(listener: (state: EditingState) => void): EditingSubscription {
  const module = native();
  if (!module) return { remove() {} };
  const subscription = new NativeEventEmitter(module).addListener("desktop", event => {
    if (event.type === "editingState") listener(event.state as EditingState);
  });
  return { remove() { subscription.remove(); } };
}
