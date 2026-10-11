import { buildAIInvocation, formatAIErrorOutput, getAICommandAvailability, runAITool, type AIToolId } from "@legendapp/spark/ai";
import { runCommand, type ProcessResult } from "@legendapp/spark/processes";
import { SegmentedControl } from "@legendapp/spark/ui/uniwind";
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { Button } from "../../Controls";
import { Panel, Status, errorText } from "../../Panel";

// "mock" exercises the screen without the claude/codex CLIs installed.
type Tool = "mock" | "claude" | "codex";
const tools = (["mock", "claude", "codex"] as const).map(value => ({ label: value, value }));
const decoder = new TextDecoder();
const succeeded = (result: ProcessResult) => result.exit.type === "exited" && result.exit.code === 0;
const mockResult = (text: string): ProcessResult => ({ stdout: new TextEncoder().encode(text), stderr: new Uint8Array(), exit: { type: "exited", code: 0 }, timedOut: false, aborted: false, outputTruncated: false });
const describe = (value: unknown) => JSON.stringify(value, (_key, field) => field instanceof Uint8Array ? decoder.decode(field) : field, 2);

function useRunner(screen: string) {
  const [tool, setTool] = useState<Tool>("mock");
  const [status, setStatus] = useState("Ready");
  const [result, setResult] = useState("No result yet.");
  async function run(pending: string, operation: (tool: Tool) => Promise<{ status: string; result: unknown }>) {
    setStatus(pending);
    try { const outcome = await operation(tool); setStatus(outcome.status); setResult(describe(outcome.result)); }
    catch (error) { setStatus("Failed."); setResult(errorText(error)); }
  }
  const refreshAvailability = () => run("Checking availability…", async selected => ({
    status: "Availability refreshed.",
    result: selected === "mock" ? { claude: true, codex: true, preferredTool: "claude" } : await getAICommandAvailability(),
  }));
  const view = (title: string, action: { label: string; onPress: () => void }, children?: ReactNode) => <Panel title={title}>
    <Status testID={`future-facing-capabilities-${screen}-status`}>{status}</Status>
    <SegmentedControl testID={`future-facing-capabilities-${screen}-tool`} accessibilityLabel="Tool" options={tools} value={tool} onValueChange={value => setTool(value as Tool)} />
    {children}
    <View className="flex-row flex-wrap justify-center gap-3">
      <Button testID={`future-facing-capabilities-${screen}-availability`} onPress={() => void refreshAvailability()}>Refresh availability</Button>
      <Button testID={`future-facing-capabilities-${screen}-run`} onPress={action.onPress}>{action.label}</Button>
    </View>
    <Text selectable className="max-w-xl text-xs text-muted" testID={`future-facing-capabilities-${screen}-result`}>{result}</Text>
  </Panel>;
  return { run, view };
}

export function CommandRunner() {
  const { run, view } = useRunner("ai-command-runner");
  return view("Command runner", { label: "Run command", onPress: () => void run("Running command…", async selected => {
    const result = selected === "mock" ? mockResult("Legend command runner") : await runCommand({ target: { type: "command", name: "echo" }, args: ["Legend command runner"], timeoutMs: 5000 });
    return { status: succeeded(result) ? "Command completed." : "Command exited with an error.", result };
  }) });
}

export function ToolRunner() {
  const [prompt, setPrompt] = useState("Return one concise sentence describing what this tester verifies.");
  const { run, view } = useRunner("ai-tool-runner");
  return view("AI tool runner", { label: "Run AI tool", onPress: () => void run("Running AI tool…", async selected => {
    const tool: AIToolId = selected === "codex" ? "codex" : "claude";
    const invocation = buildAIInvocation(tool, prompt);
    const result = selected === "mock"
      ? { ...mockResult(`mock:${invocation.command} ${invocation.args.join(" ")}`), tool, output: "Mock AI output" }
      : await runAITool({ prompt, timeoutMs: 60000, tool });
    const ok = succeeded(result);
    return { status: ok ? "AI tool completed." : "AI tool exited with an error.", result: { invocation, result, errorPreview: ok ? "" : formatAIErrorOutput(result.output) } };
  }) }, <TextInput multiline accessibilityLabel="Prompt" testID="future-facing-capabilities-ai-tool-runner-prompt" value={prompt} onChangeText={setPrompt} placeholder="Prompt"
    className="min-h-24 w-[480px] max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" placeholderTextColorClassName="accent-muted" />);
}
