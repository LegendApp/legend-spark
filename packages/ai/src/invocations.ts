import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { buildInvocationCommand } from "./invocation-command.cjs";
import type { AIInvocation, AIInvocationOptions, AIToolId } from "./types";

export function buildAIInvocation(tool: AIToolId, prompt: string, options: AIInvocationOptions = {}): AIInvocation {
  if (!["claude", "codex"].includes(tool) || typeof prompt !== "string" || !prompt.trim() || prompt.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", "Expected an AI tool and nonempty prompt");
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected invocation options");
  for (const key of Object.keys(options)) if (key !== "codex") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown invocation option: ${key}`);
  if (options.codex !== undefined) {
    if (!options.codex || typeof options.codex !== "object" || Array.isArray(options.codex)) throw new SparkError("E_INVALID_ARGUMENT", "Expected Codex invocation options");
    for (const key of Object.keys(options.codex)) if (!["model", "reasoningEffort"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown Codex option: ${key}`);
    if (options.codex.model !== undefined && (typeof options.codex.model !== "string" || !options.codex.model.trim() || /[\0\r\n]/.test(options.codex.model))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a model name");
    if (options.codex.reasoningEffort !== undefined && !["minimal", "low", "medium", "high", "xhigh"].includes(options.codex.reasoningEffort)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown reasoning effort");
    if (tool !== "codex") throw new SparkError("E_UNSUPPORTED_OPTION", "Codex options require the Codex tool");
  }
  return buildInvocationCommand(tool, prompt, options);
}
