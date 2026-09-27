import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { createDatabase, type SqlBackend } from "../packages/sqlite/src/database";
import type { SqlExecutor } from "../packages/sqlite/src/types";
function fixture() {
  const native = new DatabaseSync(":memory:");
  const close = vi.fn(() => native.close());
  const backend: SqlBackend = {
    async execute(sql, params) {
      const statement = native.prepare(sql);
      const bound = params.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (statement.columns().length) return { rows: statement.all(...bound), rowsAffected: 0 };
      const result = statement.run(...bound);
      return { rows: [], rowsAffected: Number(result.changes), insertId: Number(result.lastInsertRowid) };
    }, close,
  };
  return { db: createDatabase(backend), backend, close };
}

test("owned SQLite queries bind text and blobs, commit and roll back real SQL", async () => {
  const { db } = fixture();
  try {
    await db.run("CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT, bytes BLOB)");
    expect(await db.run("INSERT INTO items(value, bytes) VALUES (?, ?)", ["Unicode 👋 ' ", new Uint8Array([0, 128, 255])])).toMatchObject({ changes: 1, lastInsertRowId: 1 });
    expect(await db.getFirst("SELECT value, bytes FROM items")).toEqual({ value: "Unicode 👋 ' ", bytes: new Uint8Array([0, 128, 255]) });
    expect(await db.getFirst("SELECT * FROM items WHERE id = ?", [99])).toBeNull();
    expect(await db.transaction(async tx => { await tx.run("INSERT INTO items(value) VALUES (?)", ["commit"]); return 42; })).toBe(42);
    await expect(db.transaction(async tx => { await tx.run("DELETE FROM items"); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await db.getFirst("SELECT count(*) AS count FROM items")).toEqual({ count: 2 });
  } finally { await db.close(); }
});

test("transaction executors expire and direct/nested database use rejects instead of deadlocking", async () => {
  const { db } = fixture(); let retained!: SqlExecutor;
  try {
    await db.transaction(async tx => {
      retained = tx;
      await expect(db.getAll("SELECT 1")).rejects.toMatchObject({ code: "E_BUSY" });
      await expect(db.transaction(async () => {})).rejects.toMatchObject({ code: "E_BUSY" });
      await expect(db.close()).rejects.toMatchObject({ code: "E_BUSY" });
      await tx.getAll("SELECT 1");
    });
    await expect(retained.getAll("SELECT 1")).rejects.toMatchObject({ code: "E_CLOSED" });
    expect(await db.getFirst("SELECT 1 AS value")).toEqual({ value: 1 });
  } finally { await db.close(); }
});

test("a caught query error still rolls the transaction back and later operations recover", async () => {
  const { db } = fixture();
  try {
    await db.run("CREATE TABLE items(id INTEGER PRIMARY KEY)");
    await expect(db.transaction(async tx => {
      await tx.run("INSERT INTO items VALUES (1)");
      await tx.run("INSERT INTO items VALUES (1)").catch(() => {});
    })).rejects.toThrow();
    expect(await db.getAll("SELECT * FROM items")).toEqual([]);
  } finally { await db.close(); }
});

test("close joins concurrent callers, drains queued work and rejects new work", async () => {
  const { db, close } = fixture();
  const query = db.getFirst("SELECT 42 AS value");
  const closing = db.close();
  expect(db.close()).toBe(closing);
  await expect(db.getAll("SELECT 1")).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(await query).toEqual({ value: 42 });
  await closing; expect(close).toHaveBeenCalledTimes(1);
});

test("invalid parameters and unsafe returned integers are rejected", async () => {
  const backend: SqlBackend = { execute: vi.fn(async () => ({ rows: [{ value: Number.MAX_SAFE_INTEGER + 1 }], rowsAffected: 0 })), close() {} };
  const db = createDatabase(backend);
  for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, true]) {
    await expect(db.run("SELECT ?", [value as never])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  expect(backend.execute).not.toHaveBeenCalled();
  await expect(db.getAll("SELECT huge_value")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await db.close();
});
