import type { ProcessHandle, ProcessOptions, ProcessTarget } from "@legendapp/spark/processes";
export type Child = Pick<ProcessHandle, "write" | "closeInput" | "terminate" | "exited">;
export type Spawn = (options: ProcessOptions) => Promise<Child>;
export type HelperOptions = { target?: ProcessTarget; args?: string[]; readyTimeoutMs?: number; requestTimeoutMs?: number };
/** Example-owned protocol, not a framework RPC API. One client may serve all windows. */
export async function startHelper(spawn: Spawn, options: HelperOptions = {}) {
  const readyTimeout = options.readyTimeoutMs ?? 5000, requestTimeout = options.requestTimeoutMs ?? 5000;
  if (![readyTimeout, requestTimeout].every(value => Number.isFinite(value) && value > 0)) throw new Error("Timeouts must be positive");
  let child: Child | undefined, failure: Error | undefined, readySeen = false, closing = false;
  let buffer = "", diagnostics = "", next = 0, writes = Promise.resolve(), closePromise: Promise<void> | undefined;
  const pending = new Map<string, { resolve(value: Uint8Array): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => {});
  function fail(error: Error) {
    if (failure) return; failure = error; clearTimeout(readyTimer); readyReject(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear();
    void child?.terminate().catch(() => {});
  }
  const readyTimer = setTimeout(() => fail(new Error("Helper readiness timed out")), readyTimeout);
  function line(value: string) {
    if (!readySeen) { if (value !== "ready 1") throw Error("Unsupported helper handshake"); readySeen = true; clearTimeout(readyTimer); readyResolve(); return; }
    const match = /^(\d+) (ok|error) ([a-z0-9_-]+)$/.exec(value);
    if (!match) throw Error("Malformed helper response");
    const item = pending.get(match[1]!); if (!item) throw Error("Unexpected helper response ID");
    const payload = match[3]!;
    if (match[2] === "ok" && payload !== "-" && (!/^(?:[0-9a-f]{2})+$/.test(payload) || payload.length > 32768)) throw Error("Invalid helper payload");
    pending.delete(match[1]!); clearTimeout(item.timer);
    if (match[2] === "error") item.reject(new Error(`Helper rejected request: ${payload}`));
    else item.resolve(payload === "-" ? new Uint8Array() : Uint8Array.from(payload.match(/../g)!, byte => parseInt(byte, 16)));
  }
  try {
    child = await spawn({ target: options.target ?? { type: "helper", name: "worker" }, args: options.args, onOutput: chunk => {
      if (failure || closing) return;
      try {
        for (const byte of chunk.bytes) {
          if (chunk.stream === "stderr") { diagnostics = (diagnostics + String.fromCharCode(byte)).slice(-4096); continue; }
          if (byte === 10) { line(buffer); buffer = ""; }
          else { if (byte < 32 || byte > 126 || buffer.length >= 33000) throw Error("Invalid or oversized helper frame"); buffer += String.fromCharCode(byte); }
        }
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    } });
    void child.exited.then(result => { if (!closing) fail(new Error(`Helper exited (${result.exit.type === "exited" ? result.exit.code : "terminated"}): ${new TextDecoder().decode(result.stderr) || diagnostics}`)); }, error => fail(new Error(String(error))));
    if (failure) { await child.terminate(); throw failure; }
    await ready;
  } catch (error) { clearTimeout(readyTimer); await child?.terminate(); await child?.exited; throw error; }
  const process = child;
  return {
    get status() { return failure ? "failed" : closing ? "closed" : "ready"; },
    get diagnostics() { return diagnostics; },
    request(operation: "echo" | "hash" | "crash" | "hang", bytes = new Uint8Array()): Promise<Uint8Array> {
      if (failure || closing) return Promise.reject(failure ?? new Error("Helper is closed"));
      if (!["echo", "hash", "crash", "hang"].includes(operation) || !(bytes instanceof Uint8Array) || bytes.length > 16384) return Promise.reject(new Error("Invalid request or payload exceeds 16 KiB"));
      if (pending.size >= 32) return Promise.reject(new Error("Too many pending requests"));
      const id = String(++next), payload = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") || "-";
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, timer: setTimeout(() => fail(new Error(`Helper request ${id} timed out`)), requestTimeout) });
        writes = writes.then(async () => { if (!failure && !closing) await process.write(`${id} ${operation} ${payload}\n`); }).catch(error => fail(new Error(String(error))));
      });
    },
    close() {
      return closePromise ??= (async () => {
        closing = true; clearTimeout(readyTimer);
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Helper closed")); } pending.clear();
        const timer = setTimeout(() => { void process.terminate().catch(() => {}); }, 2000);
        try { await writes; await process.closeInput(); await process.exited; }
        finally { clearTimeout(timer); await process.terminate(); await process.exited; }
      })();
    },
  };
}
