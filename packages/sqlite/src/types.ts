/** A value SQLite binds or returns: NULL, TEXT, a finite number (integers must be safe unless `integers: "text"`), or a BLOB as bytes. */
export type SqlValue = null | string | number | Uint8Array;
/** A result row, by column name. */
export type SqlRow = Record<string, SqlValue>;
/** How integers come back: `number` rejects values beyond 2^53-1, `text` returns them as strings. Default `number`. */
export type IntegerMode = "number" | "text";
/** What `run` resolves with. `changes` is the number of rows the statement changed. */
export type RunResult = {
  changes: number;
  /** Connection's last insert row ID; null when the backend omits it. Text in `integers: "text"` mode. */
  lastInsertRowId: number | string | null;
};
/** Runs SQL with positional parameters: a `Database`, or the `tx` inside `transaction`. */
export interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  getAll(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  getFirst(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | null>;
}
/** An open database, from `openDatabase`. Statements run in the order they are submitted. */
export interface Database extends SqlExecutor {
  /** Row mode chosen at open. Text rows carry integers beyond 2^53−1 as strings. */
  readonly integers: IntegerMode;
  /** Use tx inside the callback. Direct database operations reject while a transaction is active. */
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Waits for already queued work. Repeated calls share completion. */
  close(): Promise<void>;
}
/** Options for `openDatabase`. `readOnly` opens without write access; `integers` picks the `IntegerMode`, default `number`. */
export type DatabaseOptions = { readOnly?: boolean; integers?: IntegerMode };
