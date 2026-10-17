/**
 * What to run: an absolute `executable` path, a `helper` bundled in the app's Helpers directory, or a `command`
 * name looked up like `resolveCommand`.
 */
export type ProcessTarget = { type: "executable"; path: string } | { type: "helper"; name: string } | { type: "command"; name: string };
/** Data for a process's stdin; strings are encoded as UTF-8. */
export type ProcessInput = string | Uint8Array;
/** A chunk of process output passed to `onOutput`, tagged with its stream. */
export type ProcessOutput = { stream: "stdout" | "stderr"; bytes: Uint8Array };
/**
 * Options for `spawn`. `input` is written to stdin at launch; `env` entries are added to the inherited environment;
 * `timeoutMs` is an integer from 1 to 4294967294 milliseconds; aborting `signal` terminates the process.
 */
export type ProcessOptions = {
  target: ProcessTarget;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  input?: ProcessInput;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maximum captured bytes per stream, 0–8 MiB; streaming remains complete. */
  captureLimitBytes?: number;
  onOutput?: (output: ProcessOutput) => void;
};
/** Options for `runCommand`; the same as `ProcessOptions`. */
export type RunCommandOptions = ProcessOptions;
/** How a process ended: `exited` with an exit code, or `terminated` with the signal number (null when none is reported, as on Windows). */
export type ProcessExit = { type: "exited"; code: number } | { type: "terminated"; signal: number | null };
/**
 * Final state of a process: its exit, captured stdout and stderr bytes (up to `captureLimitBytes` each), and whether
 * it timed out, was aborted through `signal`, or had output cut off by the capture limit.
 */
export type ProcessResult = {
  exit: ProcessExit;
  stdout: Uint8Array;
  stderr: Uint8Array;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
};
/** A running process returned by `spawn`. `exited` resolves with its `ProcessResult`. */
export interface ProcessHandle {
  readonly id: string;
  readonly exited: Promise<ProcessResult>;
  /** Strings use UTF-8; byte arrays pass through unchanged. Calls preserve order. */
  write(input: ProcessInput): Promise<void>;
  closeInput(): Promise<void>;
  /** Resolve after the process tree exits and its output drains. Retry on failure. */
  terminate(): Promise<void>;
}
