import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { Database, RunResult, SqlExecutor, SqlRow, SqlValue } from "./types";

/** Internal adapter protocol, deliberately not exported from the public entry point. */
export interface SqlBackend {
  execute(sql: string, params: (null | string | number | ArrayBuffer)[]): Promise<{ rows: unknown; rowsAffected: number; insertId?: number }>;
  close(): void | Promise<void>;
}
function validNumber(value: number, code: "E_INVALID_ARGUMENT" | "E_INVALID_DATA") {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new SparkError(code, "SQLite numbers must be finite and integers must be safely representable; select large integers as text");
  }
  return value;
}
function parameters(sql: string, params: readonly SqlValue[]) {
  if (typeof sql !== "string" || !sql.trim() || sql.includes("\0") || !Array.isArray(params)) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected SQL text and positional parameters");
  }
  return params.map(value => {
    if (value instanceof Uint8Array) return new Uint8Array(value).buffer;
    if (typeof value === "number") return validNumber(value, "E_INVALID_ARGUMENT");
    if (value === null || typeof value === "string") return value;
    throw new SparkError("E_INVALID_ARGUMENT", "SQL parameters must be null, string, number or Uint8Array");
  });
}
function rowValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") return validNumber(value, "E_INVALID_DATA");
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new SparkError("E_INVALID_DATA", "Unexpected SQLite value");
}
function rows(value: unknown): SqlRow[] {
  if (!Array.isArray(value)) throw new SparkError("E_INVALID_DATA", "Expected SQLite rows");
  return value.map(row => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new SparkError("E_INVALID_DATA", "Expected a SQLite row object");
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, rowValue(item)]));
  });
}
export function createDatabase(backend: SqlBackend): Database {
  async function executeNative(sql: string, params: (null | string | number | ArrayBuffer)[]) {
    try { return await backend.execute(sql, params); }
    catch (cause) {
      if (cause instanceof SparkError) throw cause;
      throw new SparkError("E_NATIVE", cause instanceof Error ? cause.message : "SQLite execution failed", { cause });
    }
  }
  let queue: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  let inTransaction = false;
  const closed = () => new SparkError("E_CLOSED", "Database is closing or closed");
  const busy = () => new SparkError("E_BUSY", "Use the transaction executor while a transaction is active");
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(closed());
    if (inTransaction) return Promise.reject(busy());
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  }
  function executor(schedule: <T>(operation: () => Promise<T>) => Promise<T>): SqlExecutor {
    const execute = (sql: string, params: readonly SqlValue[], read: boolean) => {
      // Copy parameters at submission so mutation while queued cannot change a query.
      const bound = parameters(sql, params);
      return schedule(async () => {
        const result = await executeNative(sql, bound);
        if (read) return rows(result.rows);
        const changes = validNumber(result.rowsAffected, "E_INVALID_DATA");
        if (!Number.isSafeInteger(changes) || changes < 0) throw new SparkError("E_INVALID_DATA", "Invalid SQLite change count");
        return { changes, lastInsertRowId: result.insertId == null ? null : validNumber(result.insertId, "E_INVALID_DATA") };
      });
    };
    return {
      async run(sql, params = []) { return await execute(sql, params, false) as RunResult; },
      async getAll(sql, params = []) { return await execute(sql, params, true) as SqlRow[]; },
      async getFirst(sql, params = []) { return (await execute(sql, params, true) as SqlRow[])[0] ?? null; },
    };
  }
  return {
    ...executor(enqueue),
    transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (typeof operation !== "function") return Promise.reject(new SparkError("E_INVALID_ARGUMENT", "Expected a transaction callback"));
      return enqueue(async () => {
        inTransaction = true;
        let accepting = true;
        let pending: Promise<unknown> = Promise.resolve();
        let failed = false;
        let failure: unknown;
        const tx = executor(<T>(action: () => Promise<T>): Promise<T> => {
          if (!accepting) return Promise.reject(new SparkError("E_CLOSED", "Transaction callback has finished"));
          const next = pending.then(() => { if (failed) throw failure; return action(); });
          pending = next.catch(error => { failed = true; failure = error; });
          return next;
        });
        try {
          await executeNative("BEGIN", []);
          try {
            const value = await operation(tx);
            accepting = false;
            await pending;
            if (failed) throw failure;
            await executeNative("COMMIT", []);
            return value;
          } catch (error) {
            accepting = false;
            await pending;
            try { await executeNative("ROLLBACK", []); }
            catch (cause) { throw new SparkError("E_NATIVE", "SQLite transaction failed and rollback also failed", { cause: new AggregateError([error, cause]) }); }
            throw error;
          }
        } finally { accepting = false; inTransaction = false; }
      });
    },
    close() {
      if (inTransaction) return Promise.reject(busy());
      return closing ??= queue.then(() => backend.close()).catch(error => { closing = undefined; throw error; });
    },
  };
}
