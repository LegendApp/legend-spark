import { Platform, TurboModuleRegistry } from "react-native";
import type { Spec } from "./NativeDesktopApp";
import { SparkError, invokeNative, parseNativeResult } from "./contracts";
import { onDesktopEvent } from "./events";

export type EditingProvider =
  | { kind: "cli"; tool: "codex" | "claude"; model?: string }
  | { kind: "local"; endpoint: string; model: string }
  | { kind: "remote"; endpoint: string; model: string; apiKey?: string };
export type EditingPhase = "idle" | "preparing" | "generating" | "migrating" | "previewing" | "applying" | "authenticating" | "submitting" | "error";
export type EditingState = {
  enabled: boolean;
  busy: boolean;
  phase: EditingPhase;
  message: string;
  ready: boolean;
  customized: boolean;
  previewing: boolean;
  migrationAvailable: boolean;
  githubAuthenticated?: boolean;
  repository?: string;
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
export type EditingGitHubAuthorization = { userCode: string; verificationUri: string; expiresIn: number };
export type EditingPullRequestOptions = { title: string };
export type EditingPullRequest = { url: string; number: number; repository: string; branch: string };

const disabled: EditingState = { enabled: false, busy: false, phase: "idle", message: "Editing is not enabled in this app", ready: false, customized: false, previewing: false, migrationAvailable: false };
function native() {
  return Platform.OS === "macos" ? TurboModuleRegistry.get<Spec>("NativeDesktopApp") : null;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function options(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value)) throw new SparkError("E_INVALID_ARGUMENT", "Editing options must be an object");
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new SparkError("E_UNSUPPORTED_OPTION", "Unknown editing option");
}
function provider(value: unknown): asserts value is EditingProvider {
  if (!record(value)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid editing provider");
  options(value, value.kind === "cli" ? ["kind", "tool", "model"] : ["kind", "endpoint", "model", "apiKey"]);
  const valid = value.kind === "cli"
    ? ["codex", "claude"].includes(value.tool as string) && (value.model === undefined || (typeof value.model === "string" && !!value.model))
    : ["local", "remote"].includes(value.kind as string) && typeof value.endpoint === "string" && typeof value.model === "string" && !!value.model && (value.apiKey === undefined || (value.kind === "remote" && typeof value.apiKey === "string"));
  if (!valid) throw new SparkError("E_INVALID_ARGUMENT", "Invalid editing provider");
}
function state(value: unknown): value is EditingState {
  return record(value) && ["enabled", "busy", "ready", "customized", "previewing", "migrationAvailable"].every(key => typeof value[key] === "boolean")
    && ["idle", "preparing", "generating", "migrating", "previewing", "applying", "authenticating", "submitting", "error"].includes(value.phase as string) && typeof value.message === "string";
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const validators: Record<string, (value: unknown) => boolean> = {
  state,
  prompt: value => record(value) && typeof value.candidate === "string" && typeof value.summary === "string" && strings(value.changedFiles) && value.status === "needs-review",
  review: value => record(value) && typeof value.text === "string" && Array.isArray(value.prompts) && value.prompts.every(item => record(item) && typeof item.prompt === "string") && (value.candidate === undefined || typeof value.candidate === "string"),
  migrate: value => record(value) && ["none", "needs-review"].includes(value.status as string) && strings(value.conflicts),
  githubBegin: value => record(value) && typeof value.userCode === "string" && value.userCode.length > 0 && value.verificationUri === "https://github.com/login/device" && typeof value.expiresIn === "number" && value.expiresIn > 0,
  submitPR: value => record(value) && typeof value.url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(value.url) && Number.isSafeInteger(value.number) && typeof value.repository === "string" && typeof value.branch === "string",
};
async function call<T>(method: string, args: object = {}): Promise<T> {
  const module = native();
  if (!module) throw new SparkError(Platform.OS === "macos" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Editing requires a Spark macOS app");
  const validate = validators[method] ?? (value => value === null);
  const value = parseNativeResult(await invokeNative(() => module.call(`editable.${method}`, JSON.stringify(args))), (value): value is T => validate(value));
  return value === null ? undefined as T : value;
}
/** Availability is safe on unsupported platforms and in apps that did not opt in. */
export async function getEditingState(): Promise<EditingState> {
  return native() ? call<EditingState>("state") : { ...disabled };
}
/** Opens Spark's built-in editor, including when automatic entry points are disabled. */
export const showEditor = (): Promise<void> => call("show");
/** Saves provider settings; remote keys go to Keychain and are never returned in state. */
export async function configureEditing(value: EditingProvider): Promise<void> { provider(value); return call("configure", { provider: value }); }
export async function generateEdit(prompt: string, value: EditingPromptOptions = {}): Promise<EditingResult> {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 32000) throw new SparkError("E_INVALID_ARGUMENT", "Enter a prompt of at most 32000 characters");
  options(value, ["provider", "allowSourceSharing", "migration"]);
  if (value.provider !== undefined) provider(value.provider);
  for (const key of ["allowSourceSharing", "migration"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${key} must be boolean`);
  return call("prompt", { prompt, ...value });
}
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
/** Starts GitHub's device flow; client ID comes from the developer's editable config. */
export const beginEditingGitHubAuth = (): Promise<EditingGitHubAuthorization> => call("githubBegin");
/** Waits for device authorization. The token stays in the app's macOS Keychain. cancelEdit stops waiting. */
export const completeEditingGitHubAuth = (): Promise<void> => call("githubComplete");
export const signOutEditingGitHub = (): Promise<void> => call("githubSignOut");
/** Publishes the reviewed candidate's cumulative patch and saved prompts to editable.repository. */
export async function submitEditPullRequest(value: EditingPullRequestOptions): Promise<EditingPullRequest> {
  options(value, ["title"]);
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 256) throw new SparkError("E_INVALID_ARGUMENT", "Enter a PR title of at most 256 characters");
  return call("submitPR", value);
}
/** Live events only: subscribe before requesting getEditingState() for an initial snapshot. */
export function onEditingState(listener: (state: EditingState) => void): EditingSubscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Editing state listener must be a function");
  if (!native()) return { remove() {} };
  return onDesktopEvent(event => { if (state(event.state)) listener(event.state); }, { types: ["editingState"] });
}
