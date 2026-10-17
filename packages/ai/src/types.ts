import type { ProcessResult } from "@legendapp/spark-processes";
/** An AI command-line tool Spark can run: the `claude` or `codex` CLI. */
export type AIToolId = "claude" | "codex";
/** Result of `getAICommandAvailability`: which CLIs resolve on this host, and the one to use (null when neither does). */
export interface AICommandAvailability { claude: boolean; codex: boolean; preferredTool: AIToolId | null }
/** Options for `getAICommandAvailability` and `selectPreferredAITool`; `preferredTool` wins when it is available. */
export interface AIAvailabilityOptions { preferredTool?: AIToolId }
/** A command line built by `buildAIInvocation`. `input` is text for stdin (set for Codex). */
export interface AIInvocation { command: string; args: readonly string[]; input?: string }
/** Codex-only options for `buildAIInvocation`: `model` is passed as `--model`; `reasoningEffort` defaults to `low`. */
export interface AICodexInvocationOptions { model?: string; reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" }
/** Tool-specific options for `buildAIInvocation` and `runAITool`. */
export interface AIInvocationOptions { codex?: AICodexInvocationOptions }
/** Options for `runAITool`. `timeoutMs` (milliseconds), `signal` and `cwd` pass through to `runCommand`. */
export interface RunAIToolOptions {
  prompt: string;
  tool: AIToolId;
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
  invocationOptions?: AIInvocationOptions;
}
/** Result of `runAITool`: the process result plus the trimmed text `output` and the `tool` that ran. */
export type AIToolRunResult = ProcessResult & { output: string; tool: AIToolId };
