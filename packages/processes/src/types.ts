export type ProcessTarget = { type: "executable"; path: string } | { type: "helper"; name: string } | { type: "command"; name: string };
export type ProcessInput = string | Uint8Array;
export type ProcessOutput = { stream: "stdout" | "stderr"; bytes: Uint8Array };
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
export type RunCommandOptions = ProcessOptions;
export type ProcessExit = { type: "exited"; code: number } | { type: "terminated"; signal: number | null };
export type ProcessResult = {
  exit: ProcessExit;
  stdout: Uint8Array;
  stderr: Uint8Array;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
};
export interface ProcessHandle {
  readonly id: string;
  readonly exited: Promise<ProcessResult>;
  /** Strings use UTF-8; byte arrays pass through unchanged. Calls preserve order. */
  write(input: ProcessInput): Promise<void>;
  closeInput(): Promise<void>;
  /** Resolve after the process tree exits and its output drains. Retry on failure. */
  terminate(): Promise<void>;
}
