import Native from "../NativeDesktopProcesses";
import { runCommand as runProcess } from "../index";
export type CommandAvailability = Record<string, boolean>;

export type CommandRunnerParams = {
  command: string;
  args?: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
};

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

export type CommandRunner = {
  getAvailability(commands: string[]): Promise<CommandAvailability>;
  runCommand(params: CommandRunnerParams): Promise<CommandRunnerResult>;
  runCommands(params: CommandRunnerParams[]): Promise<CommandRunnerResult[]>;
};


function normalizeCommands(commands: string[]) {
  return Array.from(new Set(commands.map(command => command.trim()).filter(Boolean)));
}
export async function resolveCommand(command: string): Promise<string | null> {
  if (!command || command.includes("\0")) throw new TypeError("Expected a command name");
  return JSON.parse(await Native.call("resolveCommand", JSON.stringify({ command })));
}
export const commandRunner: CommandRunner = {
  async getAvailability(commands) {
    return Object.fromEntries(await Promise.all(normalizeCommands(commands).map(async command => [command, !!await resolveCommand(command)])));
  },
  async runCommand({ command, ...options }) {
    const executable = await resolveCommand(command);
    if (!executable) throw Object.assign(new Error(`Command not found: ${command}`), { code: "command_not_found" });
    return runProcess({ executable, ...options });
  },
  async runCommands(commands) {
    const results: CommandRunnerResult[] = [];
    for (const command of commands) results.push(await this.runCommand(command));
    return results;
  },
};

export function createMockCommandRunner({
  availability = {},
  run,
}: {
  availability?: CommandAvailability;
  run?: (params: CommandRunnerParams) => Promise<CommandRunnerResult> | CommandRunnerResult;
} = {}): CommandRunner {
  const runCommand = async (params: CommandRunnerParams) => {
    if (run) {
      return run(params);
    }
    return {
      stdout: params.input ?? params.args?.join(" ") ?? "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    };
  };

  return {
    async getAvailability(commands) {
      return Object.fromEntries(normalizeCommands(commands).map((command) => [command, Boolean(availability[command])]));
    },
    runCommand,
    async runCommands(params) {
      return Promise.all(params.map(runCommand));
    },
  };
}
