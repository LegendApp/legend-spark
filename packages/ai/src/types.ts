import type { ProcessResult } from "@legendapp/spark-processes";
export type AIToolId = "claude" | "codex";
export interface AICommandAvailability { claude: boolean; codex: boolean; preferredTool: AIToolId | null }
export interface AIAvailabilityOptions { preferredTool?: AIToolId }
export interface AIInvocation { command: string; args: string[]; input?: string }
export interface AICodexInvocationOptions { model?: string; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" }
export interface AIInvocationOptions { codex?: AICodexInvocationOptions }
export interface RunAIToolOptions {
  prompt: string;
  tool: AIToolId;
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  invocationOptions?: AIInvocationOptions;
}
export type AIToolRunResult = ProcessResult & { output: string; tool: AIToolId };
