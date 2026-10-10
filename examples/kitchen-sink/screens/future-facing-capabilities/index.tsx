import { defineScreens } from "../../shell/registry";
import { CommandRunner, ToolRunner } from "./AI";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("future-facing-capabilities", [
  { id: "ai-command-runner", title: "AI: command runner", summary: "Runs a command through the processes API, or a mock result.", component: CommandRunner },
  { id: "ai-tool-runner", title: "AI: tool runner", summary: "Checks claude/codex availability and runs a prompt, or a mock invocation.", component: ToolRunner },
]);
