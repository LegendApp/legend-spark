export type SqlValue = null | string | number | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export type IntegerMode = "number" | "text";
export type RunResult = {
  changes: number;
  /** Connection's last insert row ID; null when the backend omits it. Text in `integers: "text"` mode. */
  lastInsertRowId: number | string | null;
};
export interface SqlExecutor {
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  getAll(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  getFirst(sql: string, params?: readonly SqlValue[]): Promise<SqlRow | null>;
}
export interface Database extends SqlExecutor {
  /** Row mode chosen at open. Text rows carry integers beyond 2^53−1 as strings. */
  readonly integers: IntegerMode;
  /** Use tx inside the callback. Direct database operations reject while a transaction is active. */
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Waits for already queued work. Repeated calls share completion. */
  close(): Promise<void>;
}
export type DatabaseOptions = { readOnly?: boolean; integers?: IntegerMode };
