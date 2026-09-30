import { runAITool, parseAIJson } from "@legendapp/spark/ai";
import { runCodexPrompt, shutdownCodex } from "@legendapp/spark/ai/codex";
if (false) {
  const result = await runAITool({ prompt: "test", tool: "codex", signal: new AbortController().signal });
  const bytes: Uint8Array = result.stdout;
  const value: unknown = parseAIJson(result.output);
  await runCodexPrompt("test", { outputSchema: { type: "object" }, timeoutMs: 1000 });
  const stopped: number = await shutdownCodex();
  // @ts-expect-error Transport/backend escape hatches are not part of the owned API.
  await runAITool({ prompt: "test", tool: "claude", runner: {} });
  void [bytes, value, stopped];
}
