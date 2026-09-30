import { runCommand } from "@legendapp/spark-processes";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { buildAIInvocation } from "./invocations";
import type { AIToolRunResult, RunAIToolOptions } from "./types";
export async function runAITool(options: RunAIToolOptions): Promise<AIToolRunResult> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected AI run options");
  for (const key of Object.keys(options)) if (!["prompt", "tool", "timeoutMs", "signal", "cwd", "invocationOptions"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown AI run option: ${key}`);
  const invocation = buildAIInvocation(options.tool, options.prompt, options.invocationOptions);
  const result = await runCommand({ target: { type: "command", name: invocation.command }, args: invocation.args, input: invocation.input, timeoutMs: options.timeoutMs, signal: options.signal, cwd: options.cwd });
  const decoder = new TextDecoder();
  return { ...result, output: decoder.decode(result.stdout).trim() || decoder.decode(result.stderr).trim(), tool: options.tool };
}
