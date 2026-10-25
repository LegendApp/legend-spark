// Subprocesses for tests. Async on purpose: Bun 1.3's spawnSync closes a child's stdout and stderr as
// soon as the child exits, dropping bytes it has not read yet (fixed upstream by oven-sh/bun#33832), so a
// passing binary could report empty output. A sync spawn also blocks vitest's timeout until it returns.
import { execFile, type ExecFileOptions } from "node:child_process";

export type Result = { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdout: string; stderr: string };

/** Runs `file` to completion and returns how it ended with its whole output. Rejects if it cannot start or overflows `maxBuffer`. */
export function run(file: string, args: string[] = [], options: ExecFileOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (typeof error?.code === "string") return reject(error);
      resolve({ status: error ? error.code ?? null : 0, signal: error?.signal ?? null, timedOut: error?.killed === true, stdout, stderr });
    });
  });
}

/** `run`, failing with the command, exit status or signal, stderr and stdout unless it exits 0. Returns stdout. */
export async function runOk(file: string, args: string[] = [], options: ExecFileOptions = {}): Promise<string> {
  const result = await run(file, args, options);
  if (result.status !== 0) throw new Error(`${[file, ...args].join(" ")}: ${outcome(result)}`);
  return result.stdout;
}

/** How a process ended and what it wrote, for assertion messages. */
export const outcome = ({ status, signal, timedOut, stdout, stderr }: Result) =>
  `${signal ? `killed by ${signal}${timedOut ? " at its timeout" : ""}` : `exit status ${status}`}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`;
