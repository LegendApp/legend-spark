import { Platform } from "react-native";
import { SparkError, invokeNative } from "@legendapp/spark-desktop-app/src/contracts";
import type { CodexAppServer } from "./Codex.nitro";
import { loadCodex } from "./native";

export interface CodexRunOptions {
  cwd?: string;
  developerInstructions?: string;
  outputSchema?: Record<string, unknown>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  timeoutMs?: number;
}
export interface CodexAvailability { available: boolean; codexPath: string; message: string; userAgent: string; reason?: "unsupported-platform" | "missing-module" | "missing-command" }
export interface CodexRunResult { model: string; output: string; threadId: string; turnId: string; userAgent: string }
let codex: CodexAppServer | undefined;
function getCodex(): CodexAppServer {
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Codex app-server currently requires macOS");
  if (!codex) {
    try {
      codex = loadCodex();
    } catch (cause) { throw new SparkError("E_MODULE_UNAVAILABLE", "Codex app-server module is unavailable", { cause }); }
  }
  return codex;
}
/** Advisory lookup. Does not start an AI prompt or authenticate the user. */
export async function getCodexAvailability(): Promise<CodexAvailability> {
  let native: CodexAppServer;
  try { native = getCodex(); }
  catch (error) {
    if (!(error instanceof SparkError)) throw error;
    return { available: false, codexPath: "", userAgent: "", message: error.message, reason: error.code === "E_UNSUPPORTED_PLATFORM" ? "unsupported-platform" : "missing-module" };
  }
  const result = await invokeNative(() => native.getAvailability());
  if (typeof result?.available !== "boolean" || ![result.codexPath, result.message, result.userAgent].every(value => typeof value === "string")) throw new SparkError("E_INVALID_DATA", "Invalid Codex availability");
  return { ...result, ...(result.available ? {} : { reason: "missing-command" as const }) };
}
export async function runCodexPrompt(prompt: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.includes("\0") || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a prompt and Codex options");
  for (const key of Object.keys(options)) if (!["cwd", "developerInstructions", "outputSchema", "reasoningEffort", "timeoutMs"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown Codex option: ${key}`);
  for (const key of ["cwd", "developerInstructions"] as const) if (options[key] !== undefined && (typeof options[key] !== "string" || options[key].includes("\0"))) throw new SparkError("E_INVALID_ARGUMENT", `Invalid ${key}`);
  if (options.reasoningEffort !== undefined && !["minimal", "low", "medium", "high", "xhigh"].includes(options.reasoningEffort)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown reasoning effort");
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 86_400_000)) throw new SparkError("E_INVALID_ARGUMENT", "timeoutMs must be a whole number from 1000 to 86400000 milliseconds");
  if (options.outputSchema !== undefined && (!options.outputSchema || typeof options.outputSchema !== "object" || Array.isArray(options.outputSchema))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a JSON schema object");
  let schema = "";
  try { if (options.outputSchema) schema = JSON.stringify(options.outputSchema); }
  catch (cause) { throw new SparkError("E_INVALID_ARGUMENT", "Output schema must be JSON serializable", { cause }); }
  const result = await invokeNative(() => getCodex().runPrompt(prompt, options.cwd ?? "", options.reasoningEffort ?? "low", options.timeoutMs ?? 120_000, schema, options.developerInstructions ?? ""));
  if (!result || ![result.model, result.output, result.threadId, result.turnId, result.userAgent].every(value => typeof value === "string")) throw new SparkError("E_INVALID_DATA", "Invalid Codex run result");
  return result;
}
function count(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new SparkError("E_INVALID_DATA", "Invalid Codex cancellation count");
  return value;
}
/** Process-wide: cancels every accepted run in this application's Codex supervisor. */
export async function cancelActiveCodexRuns(): Promise<number> {
  return codex ? count(await invokeNative(() => codex!.cancelActiveRuns())) : 0;
}
/** Process-wide: cancels active runs and stops the supervisor; later runs restart it. */
export async function shutdownCodex(): Promise<number> {
  if (!codex) return 0;
  const result = count(await invokeNative(() => codex!.shutdown()));
  codex = undefined;
  return result;
}
