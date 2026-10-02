import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { Database, IntegerMode, RunResult, SqlExecutor, SqlRow, SqlValue } from "./types";

/** Internal protocol: submit statements in FIFO order, snapshot bindings on submission,
 * and return fresh, mutable rows/buffers owned by the caller. Native drivers own this work. */
export interface SqlBackend {
  execute(sql: string, params: readonly SqlValue[]): Promise<{ rows: unknown; rowsAffected: number; insertId?: number | string | bigint }>;
  close(): void | Promise<void>;
}
function validNumber(value: number, code: "E_INVALID_ARGUMENT" | "E_INVALID_DATA") {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new SparkError(code, "SQLite numbers must be finite and integers must be safely representable; use integers: \"text\" for 64-bit values");
  }
  return value;
}
/** Text-mode reads turn unsafe integer values into strings so large stored rows remain readable. */
function textifyNumbers(value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === "number" && Number.isInteger(item) && !Number.isSafeInteger(item)) value[key] = String(item);
    else if (typeof item === "bigint") value[key] = item.toString();
  }
  return value;
}
function parameters(sql: string, params: readonly SqlValue[], deferred: boolean): readonly SqlValue[] {
  if (typeof sql !== "string" || !sql.trim() || sql.includes("\0") || !Array.isArray(params)) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected SQL text and positional parameters");
  }
  for (const value of params) {
    if (typeof value === "number") validNumber(value, "E_INVALID_ARGUMENT");
    else if (value !== null && typeof value !== "string" && !(value instanceof Uint8Array)) {
      throw new SparkError("E_INVALID_ARGUMENT", "SQL parameters must be null, string, number or Uint8Array");
    }
  }
  // Only Spark-deferred work needs a snapshot; direct calls are snapshotted by the driver.
  return deferred ? params.map(value => value instanceof Uint8Array ? value.slice() : value) : params;
}
function nativeError(cause: unknown): never {
  if (cause instanceof SparkError) throw cause;
  throw new SparkError("E_NATIVE", cause instanceof Error ? cause.message : "SQLite execution failed", { cause });
}
function row(value: unknown, integers: IntegerMode): SqlRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SparkError("E_INVALID_DATA", "Expected a SQLite row object");
  }
  const result = value as Record<string, unknown>;
  if (integers === "text") textifyNumbers(result);
  for (const key of Object.keys(result)) {
    const item = result[key];
    if (item === null || typeof item === "string") continue;
    if (typeof item === "number") { validNumber(item, "E_INVALID_DATA"); continue; }
    if (item instanceof Uint8Array) continue;
    if (item instanceof ArrayBuffer) { result[key] = new Uint8Array(item); continue; }
    if (ArrayBuffer.isView(item)) { result[key] = new Uint8Array(item.buffer, item.byteOffset, item.byteLength); continue; }
    throw new SparkError("E_INVALID_DATA", "Unexpected SQLite value");
  }
  return result as SqlRow;
}
type NativeResult = Awaited<ReturnType<SqlBackend["execute"]>>;
function resultRows(result: NativeResult): unknown[] {
  if (!Array.isArray(result.rows)) throw new SparkError("E_INVALID_DATA", "Expected SQLite rows");
  return result.rows;
}
function all(result: NativeResult, integers: IntegerMode): SqlRow[] {
  const values = resultRows(result);
  for (const value of values) row(value, integers);
  return values as SqlRow[];
}
function first(result: NativeResult, integers: IntegerMode): SqlRow | null {
  const values = resultRows(result);
  return values.length ? row(values[0], integers) : null;
}
function mutation(result: NativeResult, integers: IntegerMode): RunResult {
  const changes = validNumber(result.rowsAffected, "E_INVALID_DATA");
  if (!Number.isSafeInteger(changes) || changes < 0) throw new SparkError("E_INVALID_DATA", "Invalid SQLite change count");
  const insertId = result.insertId;
  if (insertId == null) return { changes, lastInsertRowId: null };
  if (typeof insertId === "bigint") return { changes, lastInsertRowId: integers === "text" ? insertId.toString() : validNumber(Number(insertId), "E_INVALID_DATA") };
  if (typeof insertId === "string") {
    if (integers !== "text" || !/^[+-]?\d+$/.test(insertId)) throw new SparkError("E_INVALID_DATA", "Invalid SQLite insert ID");
    return { changes, lastInsertRowId: insertId };
  }
  if (integers === "text" && !Number.isSafeInteger(insertId)) return { changes, lastInsertRowId: insertId.toString() };
  return { changes, lastInsertRowId: validNumber(insertId, "E_INVALID_DATA") };
}
type Submit = <T>(sql: string, params: readonly SqlValue[], convert: (result: NativeResult) => T) => Promise<T>;
function executor(submit: Submit, integers: IntegerMode): SqlExecutor {
  return {
    run: (sql, params = []) => submit(sql, params, result => mutation(result, integers)),
    getAll: (sql, params = []) => submit(sql, params, result => all(result, integers)),
    getFirst: (sql, params = []) => submit(sql, params, result => first(result, integers)),
  };
}
export function createDatabase(backend: SqlBackend, integers: IntegerMode = "number"): Database {
  let pending = 0;
  let idle: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let barrier: Promise<void> | undefined;
  let inTransaction = false;
  const closed = () => new SparkError("E_CLOSED", "Database is closing or closed");
  const busy = () => new SparkError("E_BUSY", "Use the transaction executor while a transaction is active");
  function finished() { if (--pending === 0) { const resolve = idle; idle = undefined; resolve?.(); } }
  function execute<T>(sql: string, params: readonly SqlValue[], convert: (result: NativeResult) => T): Promise<T> {
    if (closing) return Promise.reject(closed());
    if (inTransaction) return Promise.reject(busy());
    const blocked = barrier;
    let bound: readonly SqlValue[];
    try { bound = parameters(sql, params, blocked !== undefined); }
    catch (error) { return Promise.reject(error); }
    pending++;
    const submit = () => {
      try {
        return backend.execute(sql, bound).then(result => {
          try { return convert(result); } finally { finished(); }
        }, cause => { finished(); return nativeError(cause); });
      } catch (cause) { finished(); return Promise.reject(cause).catch(nativeError); }
    };
    return blocked ? blocked.then(submit) : submit();
  }
  return {
    integers,
    ...executor(execute, integers),
    transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (typeof operation !== "function") return Promise.reject(new SparkError("E_INVALID_ARGUMENT", "Expected a transaction callback"));
      if (closing) return Promise.reject(closed());
      if (inTransaction) return Promise.reject(busy());
      pending++;
      const perform = async () => {
        let accepting = true;
        let statements: Promise<unknown> = Promise.resolve();
        let failed = false;
        let failure: unknown;
        const tx = executor(<R>(sql: string, params: readonly SqlValue[], convert: (result: NativeResult) => R): Promise<R> => {
          if (!accepting) return Promise.reject(new SparkError("E_CLOSED", "Transaction callback has finished"));
          let bound: readonly SqlValue[];
          try { bound = parameters(sql, params, true); }
          catch (error) { return Promise.reject(error); }
          // Preserve transaction poisoning: caught errors still roll back, and later
          // accepted statements cannot run after an earlier statement has failed.
          const next = statements.then(() => {
            if (failed) throw failure;
            try { return backend.execute(sql, bound).then(convert, nativeError); }
            catch (cause) { return nativeError(cause); }
          });
          statements = next.catch(error => { failed = true; failure = error; });
          return next;
        }, integers);
        try {
          try { await backend.execute("BEGIN", []); } catch (cause) { nativeError(cause); }
          inTransaction = true;
          try {
            const value = await operation(tx);
            accepting = false;
            await statements;
            if (failed) throw failure;
            try { await backend.execute("COMMIT", []); } catch (cause) { nativeError(cause); }
            return value;
          } catch (error) {
            accepting = false;
            await statements;
            try { await backend.execute("ROLLBACK", []); }
            catch (cause) { throw new SparkError("E_NATIVE", "SQLite transaction failed and rollback also failed", { cause: new AggregateError([error, cause]) }); }
            throw error;
          }
        } finally { accepting = false; inTransaction = false; }
      };
      const operationResult = barrier ? barrier.then(perform) : perform();
      const completion = operationResult.then(() => {}, () => {});
      barrier = completion;
      // Only multi-statement callbacks reserve a JS barrier; ordinary statements
      // go straight to the driver's native queue.
      void completion.then(() => { if (barrier === completion) barrier = undefined; });
      return operationResult.then(value => { finished(); return value; }, error => { finished(); throw error; });
    },
    close() {
      if (inTransaction) return Promise.reject(busy());
      if (closing) return closing;
      const drained = pending ? new Promise<void>(resolve => { idle = resolve; }) : Promise.resolve();
      closing = drained.then(() => backend.close()).then(() => {}).catch(error => { closing = undefined; throw error; });
      return closing;
    },
  };
}
