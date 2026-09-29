import { parseArgs } from "node:util";
import { buildMode } from "./build-mode.ts";

const options = {
  example: { type: "string" }, "package-manager": { type: "string" },
  runtime: { type: "string", multiple: true }, universal: { type: "boolean" },
  device: { type: "string" }, project: { type: "string" }, platform: { type: "string" },
  packages: { type: "string" }, port: { type: "string" }, runner: { type: "boolean" },
  dev: { type: "boolean" }, release: { type: "boolean" }, preview: { type: "boolean" },
  force: { type: "boolean" }, "submission-id": { type: "string" }, help: { type: "boolean", short: "h" },
} as const;
const commands: Record<string, { flags: readonly string[]; arguments: readonly [number, number] }> = {
  create: { flags: ["example", "package-manager", "universal", "platform", "packages"], arguments: [1, 1] },
  "add desktop": { flags: ["project", "packages"], arguments: [0, 0] },
  "sdk export": { flags: ["packages", "runtime"], arguments: [1, 1] },
  "sdk import": { flags: [], arguments: [1, 1] },
  "sdk register": { flags: [], arguments: [1, 1] },
  "sdk pack": { flags: ["project", "platform"], arguments: [0, 0] },
  "sdk package-runner": { flags: ["project", "platform", "force", "submission-id"], arguments: [0, 0] },
  "sdk build-runner": { flags: ["project", "platform", "packages", "package-manager", "force"], arguments: [0, 0] },
  build: { flags: ["project", "platform", "device", "port", "runner", "dev", "release", "preview", "force"], arguments: [0, 0] },
  prebuild: { flags: ["project", "platform"], arguments: [0, 0] },
  doctor: { flags: ["project"], arguments: [0, 0] },
  "updates init": { flags: ["project", "platform"], arguments: [1, 1] },
  credentials: { flags: ["project", "platform"], arguments: [0, 0] },
  package: { flags: ["project", "platform", "force", "submission-id"], arguments: [0, 0] },
  analyze: { flags: ["project", "platform"], arguments: [0, 0] },
  open: { flags: ["project", "platform", "port"], arguments: [0, 1] },
};
/** Validate the command grammar before resolving a project or performing side effects. */
export function cliArguments(args: string[]) {
  const parsed = parseArgs({ args, allowPositionals: true, options });
  const { values, positionals } = parsed;
  const grouped = ["sdk", "add", "updates"].includes(positionals[0]);
  const command = positionals.slice(0, grouped ? 2 : 1).join(" ");
  if (!command || (grouped && positionals.length === 1 && values.help)) {
    if (Object.keys(values).some(key => key !== "help")) throw new Error("Choose a command before specifying options. Run spark --help.");
    return parsed;
  }
  const contract = commands[command];
  if (!contract) throw new Error(`Unknown command: ${command}. Run spark --help.`);
  for (const key of Object.keys(values)) if (key !== "help" && !contract.flags.includes(key)) throw new Error(`--${key} is not an option for spark ${command}`);
  const count = positionals.length - (grouped ? 2 : 1);
  if ((!values.help && count < contract.arguments[0]) || count > contract.arguments[1]) throw new Error(`Invalid arguments for spark ${command}. Expected ${contract.arguments[0] === contract.arguments[1] ? contract.arguments[0] : "zero or one"} positional argument(s).`);
  if (values.platform && !["macos", "windows", "ios", "android", "web"].includes(values.platform)) throw new Error("Platform must be macos, windows, ios, android, or web.");
  if (values.port !== undefined && (!Number.isInteger(Number(values.port)) || Number(values.port) < 1 || Number(values.port) > 65535)) throw new Error("Port must be an integer between 1 and 65535.");
  if (values["package-manager"] && !["npm", "pnpm", "yarn", "bun"].includes(values["package-manager"])) throw new Error("Package manager must be npm, pnpm, yarn, or bun.");
  if (command === "build") buildMode(values);
  if (command === "sdk build-runner" && values.project && (values.packages || values["package-manager"])) throw new Error("--packages and --package-manager configure a generated Runner project; omit --project to use them.");
  return parsed;
}
