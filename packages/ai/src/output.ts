import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** Options for `formatAIErrorOutput`. `maxLength` is in characters, a positive integer (default 300). */
export interface AIErrorOutputOptions { maxLength?: number }
const defaultMaxErrorOutputLength = 300;

/**
 * Finds JSON text in AI output: the first fenced code block, the whole trimmed text when it starts with `{` or `[`,
 * or the span from the first bracket to the last closing bracket of the same kind. Returns null when there is none.
 * Throws E_INVALID_ARGUMENT for non-string input.
 */
export function extractJsonCandidate(text: string): string | null {
  if (typeof text !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected AI output text");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace === -1) {
    return null;
  }

  const open = trimmed[firstBrace];
  const close = open === "{" ? "}" : "]";
  const lastBrace = trimmed.lastIndexOf(close);
  if (lastBrace <= firstBrace) {
    return null;
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

/** Parses the JSON that `extractJsonCandidate` finds; null when there is none or it does not parse. */
export function parseAIJson(text: string): unknown {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Trims command output for an error message, cutting it to `maxLength` characters (default 300) plus `...`.
 * Throws E_INVALID_ARGUMENT or E_UNSUPPORTED_OPTION for invalid options.
 */
export function formatAIErrorOutput(output: string, options: AIErrorOutputOptions = {}): string {
  if (typeof output !== "string" || !options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected output text and preview options");
  for (const key of Object.keys(options)) if (key !== "maxLength") throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown preview option: ${key}`);
  const maxLength = options.maxLength ?? defaultMaxErrorOutputLength;
  if (!Number.isInteger(maxLength) || maxLength < 1) throw new SparkError("E_INVALID_ARGUMENT", "maxLength must be a positive integer");
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trim()}...`;
}
