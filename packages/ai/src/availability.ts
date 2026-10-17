import { resolveCommand, getProcessAvailability } from "@legendapp/spark-processes";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { AIAvailabilityOptions, AICommandAvailability, AIToolId } from "./types";
/**
 * Picks `options.preferredTool` when it is available, otherwise `claude`, then `codex`, or null when neither is.
 * Throws E_INVALID_ARGUMENT or E_UNSUPPORTED_OPTION for invalid options.
 */
export function selectPreferredAITool(availability: Pick<AICommandAvailability, "claude" | "codex">, options: AIAvailabilityOptions = {}): AIToolId | null {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected AI availability options");
  for (const key of Object.keys(options)) if (key !== "preferredTool") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown availability option: ${key}`);
  if (options.preferredTool !== undefined && !["claude", "codex"].includes(options.preferredTool)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown preferred AI tool");
  if (options.preferredTool && availability[options.preferredTool]) return options.preferredTool;
  return availability.claude ? "claude" : availability.codex ? "codex" : null;
}
/**
 * Checks whether the `claude` and `codex` commands resolve on this host, and which one to prefer. Reports neither
 * available where processes are unsupported (anything but macOS and Windows).
 */
export async function getAICommandAvailability(options: AIAvailabilityOptions = {}): Promise<AICommandAvailability> {
  selectPreferredAITool({ claude: false, codex: false }, options);
  if (!getProcessAvailability().available) return { claude: false, codex: false, preferredTool: null };
  const [claude, codex] = await Promise.all([resolveCommand("claude"), resolveCommand("codex")]);
  const result = { claude: claude !== null, codex: codex !== null };
  return { ...result, preferredTool: selectPreferredAITool(result, options) };
}
