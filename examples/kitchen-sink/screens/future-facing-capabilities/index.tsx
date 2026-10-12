import { defineScreens } from "../../shell/registry";
import { CommandRunner, ToolRunner } from "./AI";
import { Plugins } from "./Plugins";

// Ported from legend-apps' apps/test-kitchen-sink.
export default defineScreens("future-facing-capabilities", [
  { id: "ai-command-runner", title: "AI: command runner", summary: "Runs a command through the processes API, or a mock result.", component: CommandRunner },
  { id: "ai-tool-runner", title: "AI: tool runner", summary: "Checks claude/codex availability and runs a prompt, or a mock invocation.", component: ToolRunner },
  { id: "plugins", title: "Plugins", summary: "Bundled plugins loaded into isolated runtimes: manifest, API version and capability checks, registered commands, panels, file types and menu items, a rejected sandbox violation, error isolation and unload.", component: Plugins },
]);
