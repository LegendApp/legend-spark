import { readJson } from "./json.ts";
import path from "node:path";
import { spawn as nodeSpawn, type ChildProcess, type StdioOptions, type Serializable } from "node:child_process";
import { createRequire } from "node:module";
import { constants as osConstants } from "node:os";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { Readable, type Writable } from "node:stream";

const spawn: typeof nodeSpawn = createRequire(import.meta.url)("cross-spawn");
export type ProcessLog = { file: string };
export function processLog(file: string): ProcessLog { return { file }; }
export type ProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: "pipe" | "inherit" | "ignore";
  stdout?: "pipe" | "inherit" | "ignore" | ProcessLog | number;
  stderr?: "pipe" | "inherit" | "ignore" | ProcessLog | number;
  detached?: boolean;
  serialization?: "json";
  ipc?: (message: any, child: ManagedProcess) => void;
};
export type ManagedProcess = {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdin: Writable | null;
  readonly pid: number | undefined;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
  send(message: Serializable): void;
};
/** Process ownership shared by builds, native runners and Expo's terminal/IPC. */
export function spawnProcess(argv: string[], options: ProcessOptions = {}): ManagedProcess {
  const descriptors = new Map<string, number>();
  function output(value: ProcessOptions["stdout"]) {
    if (value && typeof value === "object") {
      if (!descriptors.has(value.file)) {
        mkdirSync(path.dirname(value.file), { recursive: true });
        descriptors.set(value.file, openSync(value.file, "w"));
      }
      return descriptors.get(value.file)!;
    }
    return value ?? "pipe";
  }
  let child: ChildProcess;
  try {
    const stdio: StdioOptions = [options.stdin ?? "ignore", output(options.stdout), output(options.stderr), ...(options.ipc ? ["ipc" as const] : [])];
    child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, env: options.env ?? process.env, stdio, detached: options.detached, serialization: options.serialization ?? "json" });
  } finally {
    // The child owns duplicated handles; do not leak parent descriptors.
    for (const descriptor of descriptors.values()) closeSync(descriptor);
  }
  let exitCode: number | null = null;
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", error => { exitCode = 1; reject(error); });
    child.once("exit", (code, signal) => { exitCode = code ?? 128 + (osConstants.signals[signal!] ?? 1); });
    // close guarantees piped output has drained, unlike exit.
    child.once("close", (code, signal) => { exitCode = code ?? 128 + (osConstants.signals[signal!] ?? 1); resolve(exitCode); });
  });
  // A caller may be draining output before awaiting completion.
  void exited.catch(() => {});
  const result: ManagedProcess = {
    get exitCode() { return exitCode; },
    get signalCode() { return child.signalCode; },
    get stdin() { return child.stdin; },
    get pid() { return child.pid; },
    stdout: child.stdout ? Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array> : null,
    stderr: child.stderr ? Readable.toWeb(child.stderr) as unknown as ReadableStream<Uint8Array> : null,
    exited,
    kill(signal = "SIGTERM") { child.kill(signal); },
    send(message) { if (child.connected) child.send(message, () => {}); },
  };
  if (options.ipc) child.on("message", message => options.ipc!(message, result));
  return result;
}
export { which } from "./executable.ts";

// Windows .cmd shims are shell programs; run the package's actual JS entry.
export function nodeCommand(root: string, name: string, bin: string, args: string[] = []) {
  const req = createRequire(path.join(root, "package.json"));
  const file = req.resolve(`${name}/package.json`), pkg = readJson(file);
  return ["node", path.resolve(path.dirname(file), typeof pkg.bin === "string" ? pkg.bin : pkg.bin[bin]), ...args];
}
