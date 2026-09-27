import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { createDatabase } from "./database";
import type { Database, DatabaseOptions } from "./types";
export type { Database, DatabaseOptions, SqlExecutor, SqlRow, SqlValue, RunResult } from "./types";

/** Open a project-scoped database. Integers outside JS's safe range must be selected as text. */
export async function openDatabase(name: string, options: DatabaseOptions = {}): Promise<Database> {
  if (!/^[a-zA-Z0-9_-]+\.sqlite$/.test(name)) throw new SparkError("E_INVALID_ARGUMENT", "Database name must be a simple .sqlite filename");
  if (Object.keys(options).some(key => key !== "readOnly") || (options.readOnly !== undefined && typeof options.readOnly !== "boolean")) {
    throw new SparkError("E_INVALID_ARGUMENT", "Invalid database options");
  }
  const [{ open }, { getDirectory }] = await Promise.all([import("@op-engineering/op-sqlite"), import("@legendapp/spark-file-system")]);
  const native = open({ name, location: await getDirectory("data"), readOnly: options.readOnly });
  return createDatabase({ execute: (sql, params) => native.execute(sql, params), close: () => native.close() });
}
