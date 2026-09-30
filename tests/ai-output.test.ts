import { describe, it, expect } from "vitest";
import { extractJsonCandidate, formatAIErrorOutput, parseAIJson } from "../packages/ai/src/output";

describe("AI output helpers", () => {
  it("extracts raw JSON", () => {
    expect(extractJsonCandidate('{"ok":true}')).toBe('{"ok":true}');
  });

  it("extracts fenced JSON", () => {
    expect(extractJsonCandidate('Here:\n```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("extracts prose-wrapped JSON", () => {
    expect(extractJsonCandidate('Here is the result: {"ok":true}.')).toBe('{"ok":true}');
  });

  it("parses extracted JSON", () => {
    expect(parseAIJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("returns null for invalid JSON", () => {
    expect(parseAIJson("not json")).toBeNull();
  });

  it("formats long error output", () => {
    expect(formatAIErrorOutput("abcdef", { maxLength: 3 })).toBe("abc...");
  });
});
