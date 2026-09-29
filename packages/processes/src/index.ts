import { Platform } from "react-native";
import { fromByteArray, toByteArray } from "base64-js";
import Native from "./NativeDesktopProcesses";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import { SparkError, invokeNative, nativeError, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import type { ProcessOptions, RunCommandOptions, ProcessInput, ProcessResult, ProcessHandle } from "./types";
export type * from "./types";
export function getProcessAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
async function call<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Processes require a desktop host");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "Process module is unavailable");
  return parseNativeResult(await invokeNative(() => Native!.call(method, JSON.stringify(args))), validate);
}
const command = (method: string, args: object) => call(method, args, (value): value is null => value === null).then(() => {});
function invalid(message: string): never { throw new SparkError("E_INVALID_ARGUMENT", message); }
function object(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected process options");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown process option: ${key}`);
}
function commandName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || /[\\/\0:]/.test(value) || value === "." || value === ".." || value.trim() !== value) invalid("Expected a command name without path components");
}
export async function resolveCommand(name: string): Promise<string | null> {
  commandName(name);
  const value = await call("resolveCommand", { command: name }, (value): value is string | null => value === null || typeof value === "string");
  if (value === null) return null;
  try { return nativePath(value, Platform.OS); } catch (cause) { throw new SparkError("E_INVALID_DATA", "Resolved command path is invalid", { cause }); }
}
function encode(input: ProcessInput): string {
  if (typeof input === "string") return fromByteArray(new TextEncoder().encode(input));
  if (!(input instanceof Uint8Array)) invalid("Process input must be UTF-8 text or Uint8Array");
  return fromByteArray(input);
}
function decode(value: unknown, maximum = 8 * 1024 * 1024): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new SparkError("E_INVALID_DATA", "Invalid process output bytes");
  const bytes = toByteArray(value);
  if (bytes.length > maximum || fromByteArray(bytes) !== value) throw new SparkError("E_INVALID_DATA", "Invalid process output encoding");
  return bytes;
}
function result(value: unknown, aborted: boolean, limit: number): ProcessResult {
  if (!value || typeof value !== "object") throw new SparkError("E_INVALID_DATA", "Invalid process exit result");
  const data = value as Record<string, unknown>;
  if (!Number.isInteger(data.exitCode) || (data.exitCode as number) < 0 || (data.exitCode as number) > 0xffffffff || typeof data.terminated !== "boolean" || !(data.terminationSignal === null || (Number.isInteger(data.terminationSignal) && (data.terminationSignal as number) > 0)) || (!data.terminated && data.terminationSignal !== null) || typeof data.timedOut !== "boolean" || typeof data.outputTruncated !== "boolean") throw new SparkError("E_INVALID_DATA", "Invalid process exit status");
  return { exit: data.terminated ? { type: "terminated", signal: data.terminationSignal as number | null } : { type: "exited", code: data.exitCode as number }, stdout: decode(data.stdoutBase64, limit), stderr: decode(data.stderrBase64, limit), timedOut: data.timedOut, outputTruncated: data.outputTruncated, aborted };
}
let sequence = 0;
export async function spawn(options: ProcessOptions): Promise<ProcessHandle> {
  object(options, ["target", "args", "cwd", "env", "input", "timeoutMs", "signal", "captureLimitBytes", "onOutput"]);
  object(options.target, ["type", "path", "name"]);
  const { target, signal, onOutput } = options;
  let executable: string;
  if (target.type === "executable") { object(target, ["type", "path"]); executable = nativePath(target.path, Platform.OS); }
  else if (target.type === "helper") { object(target, ["type", "name"]); if (typeof target.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(target.name)) invalid("Invalid helper name"); executable = `helper:${target.name}`; }
  else if (target.type === "command") { object(target, ["type", "name"]); commandName(target.name); executable = target.name; }
  else invalid("Unknown process target type");
  if (options.args !== undefined && (!Array.isArray(options.args) || options.args.some(arg => typeof arg !== "string" || arg.includes("\0")))) invalid("Invalid process arguments");
  const cwd = options.cwd === undefined ? undefined : nativePath(options.cwd, Platform.OS);
  if (options.env !== undefined) {
    if (!options.env || typeof options.env !== "object" || Array.isArray(options.env) || Object.entries(options.env).some(([key, value]) => !key || /[=\0]/.test(key) || typeof value !== "string" || value.includes("\0"))) invalid("Invalid process environment");
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 0xfffffffe)) invalid("timeoutMs must be an integer from 1 to 4294967294");
  const captureLimitBytes = options.captureLimitBytes ?? 8 * 1024 * 1024;
  if (!Number.isInteger(captureLimitBytes) || captureLimitBytes < 0 || captureLimitBytes > 8 * 1024 * 1024) invalid("captureLimitBytes must be an integer from 0 to 8388608");
  if (onOutput !== undefined && typeof onOutput !== "function") invalid("onOutput must be a function");
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) invalid("Expected an AbortSignal");
  const wire = { executable, args: options.args ? [...options.args] : [], cwd, env: options.env ? { ...options.env } : {}, inputBase64: options.input === undefined ? undefined : encode(options.input), timeoutMs: options.timeoutMs, captureLimitBytes, streamOutput: !!onOutput };
  if (signal?.aborted) throw new SparkError("E_ABORTED", "Process launch was aborted");
  if (target.type === "command") {
    const resolved = await resolveCommand(executable);
    if (!resolved) throw new SparkError("E_NOT_FOUND", `Command not found: ${executable}`);
    wire.executable = resolved;
  }
  if (signal?.aborted) throw new SparkError("E_ABORTED", "Process launch was aborted");
  const availability = getProcessAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Process execution is unavailable");
  const id = `process-${Date.now()}-${++sequence}`;
  let finish!: (value: ProcessResult) => void, fail!: (error: unknown) => void;
  let ended = false, aborted = false, started = false, inputClosing = false, outputStopped = false;
  let writes = Promise.resolve(), closingInput: Promise<void> | undefined, terminating: Promise<void> | undefined;
  let settleExit!: () => void;
  const exitObserved = new Promise<void>(resolve => { settleExit = resolve; });
  const exited = new Promise<ProcessResult>((resolve, reject) => { finish = resolve; fail = reject; });
  // Exit can precede the spawn acknowledgement, before callers receive the handle.
  void exited.catch(() => {});
  function abort() { if (!ended) { aborted = true; if (started) void terminate().catch(fail); } }
  function terminate(): Promise<void> {
    if (ended) return Promise.resolve();
    return terminating ??= command("terminate", { id }).then(() => exitObserved).catch(error => { terminating = undefined; throw error; });
  }
  const subscription = onDesktopEvent(event => {
    if (event.processId !== id || ended) return;
    if (event.type === "processExit") {
      ended = true; subscription.remove(); signal?.removeEventListener("abort", abort); settleExit();
      try { finish(result(event.result, aborted, captureLimitBytes)); } catch (error) { fail(error); }
    } else if (event.type === "processOutput" && !outputStopped) {
      try {
        if (event.stream !== "stdout" && event.stream !== "stderr") throw new SparkError("E_INVALID_DATA", "Invalid process output stream");
        const bytes = decode(event.base64, 16384);
        onOutput?.({ stream: event.stream, bytes });
      } catch (error) { outputStopped = true; fail(nativeError(error)); void terminate().catch(fail); }
    }
  });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await command("spawn", { id, ...wire }); started = true;
    if (signal?.aborted) abort();
    if (aborted) void terminate().catch(fail);
  } catch (error) {
    subscription.remove(); signal?.removeEventListener("abort", abort);
    // A malformed acknowledgement can follow successful allocation.
    if (error instanceof SparkError && error.code === "E_INVALID_DATA") {
      try { await command("terminate", { id }); }
      catch (cleanup) { throw new SparkError("E_NATIVE", "Process launch and termination failed", { cause: new AggregateError([error, cleanup]) }); }
    }
    throw error;
  }
  return {
    id, exited,
    async write(input) {
      const base64 = encode(input);
      if (ended || inputClosing) throw new SparkError("E_CLOSED", "Process input is closed");
      const operation = writes.then(() => command("write", { id, base64 }));
      writes = operation.catch(() => {}); return operation;
    },
    closeInput() {
      inputClosing = true;
      if (ended) return Promise.resolve();
      return closingInput ??= writes.then(() => command("closeInput", { id })).catch(error => { closingInput = undefined; throw error; });
    },
    terminate,
  };
}
export async function runCommand(options: RunCommandOptions): Promise<ProcessResult> {
  const child = await spawn(options);
  try { await child.closeInput(); return await child.exited; }
  catch (error) {
    try { await child.terminate(); }
    catch (cleanup) { throw new SparkError("E_NATIVE", "Command and termination failed", { cause: new AggregateError([error, cleanup]) }); }
    throw error;
  }
}
