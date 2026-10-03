import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { createDatabase } from "./database";
import type { Database, DatabaseOptions } from "./types";
export type { Database, DatabaseOptions, IntegerMode, SqlExecutor, SqlRow, SqlValue, RunResult } from "./types";

/**
 * Open a project-scoped database. Backends deliver INTEGER values as JS numbers, so
 * `integers: "text"` reads values outside 2^53−1 as text instead of rejecting them;
 * exact digits beyond the double's precision still require `CAST(col AS TEXT)`.
 */
export async function openDatabase(name: string, options: DatabaseOptions = {}): Promise<Database> {
  if (!/^[a-zA-Z0-9_-]+\.sqlite$/.test(name)) throw new SparkError("E_INVALID_ARGUMENT", "Database name must be a simple .sqlite filename");
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected database options");
  for (const key of Object.keys(options)) if (key !== "readOnly" && key !== "integers") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported database option: ${key}`);
  if (options.readOnly !== undefined && typeof options.readOnly !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "readOnly must be a boolean");
  if (options.integers !== undefined && options.integers !== "number" && options.integers !== "text") throw new SparkError("E_INVALID_ARGUMENT", "integers must be number or text");
  const [{ open }, { getDirectory }] = await Promise.all([import("@op-engineering/op-sqlite"), import("@legendapp/spark-file-system")]);
  const native = open({ name, location: await getDirectory("data"), readOnly: options.readOnly });
  return createDatabase({ execute: (sql, params) => native.execute(sql, params as import("@op-engineering/op-sqlite").Scalar[]), close: () => native.close() }, options.integers ?? "number");
}
