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

// These boundaries also guard adapter cost: ordinary calls submit immediately,
// retain fresh driver results, and leave eager binding snapshots to the driver.
test("ordinary queries submit immediately and close waits for every accepted result", async () => {
  let resolveFirst!: (result: { rows: unknown[]; rowsAffected: number }) => void;
  let resolveSecond!: (result: { rows: unknown[]; rowsAffected: number }) => void;
  const backend: SqlBackend = {
    execute: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; })),
    close: vi.fn(),
  };
  const db = createDatabase(backend);
  const first = db.getFirst("SELECT first");
  const second = db.getFirst("SELECT second");
  expect(backend.execute).toHaveBeenCalledTimes(2);
  const closing = db.close();
  resolveSecond({ rows: [{ value: 2 }], rowsAffected: 0 });
  expect(await second).toEqual({ value: 2 });
  expect(backend.close).not.toHaveBeenCalled();
  resolveFirst({ rows: [{ value: 1 }], rowsAffected: 0 });
  expect(await first).toEqual({ value: 1 });
  await closing;
  expect(backend.close).toHaveBeenCalledTimes(1);
});

test("getFirst normalizes only its requested row and retains the fresh driver's buffer", async () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  const first = { bytes: buffer };
  const rows = [first];
  Object.defineProperty(rows, 1, { get() { throw new Error("unrequested row accessed"); } });
  const backend: SqlBackend = { execute: vi.fn(async () => ({ rows, rowsAffected: 0 })), close() {} };
  const db = createDatabase(backend);
  const result = await db.getFirst("SELECT bytes");
  expect(result).toBe(first);
  expect(result?.bytes).toBeInstanceOf(Uint8Array);
  expect((result?.bytes as Uint8Array).buffer).toBe(buffer);
  await db.close();
});

test("getAll returns the driver's fresh array and normalizes byte views without copying", async () => {
  const buffer = new Uint8Array([0, 128, 255, 4]).buffer;
  const rows = [{ bytes: new DataView(buffer, 1, 2), value: "text" }];
  const backend: SqlBackend = { execute: vi.fn(async () => ({ rows, rowsAffected: 0 })), close() {} };
  const db = createDatabase(backend);
  const result = await db.getAll("SELECT bytes, value");
  expect(result).toBe(rows);
  expect(result[0]).toBe(rows[0]);
  expect(result[0].bytes).toEqual(new Uint8Array([128, 255]));
  expect((result[0].bytes as Uint8Array).buffer).toBe(buffer);
  await db.close();
});

test("eager submission forwards bindings and byte views directly to the snapshotting driver", async () => {
  const { db, backend } = fixture();
  try {
    await db.run("CREATE TABLE bytes(value TEXT, bytes BLOB)");
    const execute = vi.spyOn(backend, "execute");
    const bytes = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
    const params = ["before", bytes];
    const write = db.run("INSERT INTO bytes VALUES(?, ?)", params);
    expect(execute.mock.calls[0][1]).toBe(params);
    expect(execute.mock.calls[0][1][1]).toBe(bytes);
    bytes.fill(8); params[0] = "after";
    await write;
    expect(await db.getFirst("SELECT * FROM bytes")).toEqual({ value: "before", bytes: new Uint8Array([1, 2]) });
  } finally { await db.close(); }
});

test("transaction barriers preserve submission order without queuing ordinary queries twice", async () => {
  const { db } = fixture();
  try {
    await db.run("CREATE TABLE items(value TEXT)");
    const first = db.transaction(tx => tx.run("INSERT INTO items VALUES('first transaction')"));
    const between = db.run("INSERT INTO items VALUES('between')");
    const second = db.transaction(tx => tx.run("INSERT INTO items VALUES('second transaction')"));
    await Promise.all([first, between, second]);
    expect(await db.getAll("SELECT value FROM items ORDER BY rowid")).toEqual([
      { value: "first transaction" }, { value: "between" }, { value: "second transaction" },
    ]);
  } finally { await db.close(); }
});

test("Spark-deferred bindings are snapshotted and close drains pending transactions", async () => {
  const { db, backend, close } = fixture();
  await db.run("CREATE TABLE items(value TEXT, bytes BLOB)");
  const originalExecute = backend.execute;
  let releaseBegin!: () => void;
  backend.execute = (sql, params) => {
    const result = originalExecute(sql, params);
    return sql === "BEGIN" ? new Promise(resolve => { releaseBegin = () => { void result.then(resolve); }; }) : result;
  };
  const transaction = db.transaction(tx => tx.run("INSERT INTO items(value) VALUES('transaction')"));
  const bytes = new Uint8Array([1, 2]);
  const params = ["before", bytes];
  const deferred = db.run("INSERT INTO items VALUES(?,?)", params);
  bytes.fill(8); params[0] = "after";
  const stored = db.getAll("SELECT * FROM items ORDER BY rowid");
  const closing = db.close();
  expect(close).not.toHaveBeenCalled();
  releaseBegin();
  const [, , rows] = await Promise.all([transaction, deferred, stored, closing]);
  expect(rows).toEqual([{ value: "transaction", bytes: null }, { value: "before", bytes: new Uint8Array([1, 2]) }]);
  expect(close).toHaveBeenCalledTimes(1);
});

test("native failures release in-flight ownership and failed close can be retried", async () => {
  const backend: SqlBackend = {
    execute: vi.fn(() => { throw new Error("native failure"); }),
    close: vi.fn().mockRejectedValueOnce(new Error("close failure")).mockResolvedValue(undefined),
  };
  const db = createDatabase(backend);
  await expect(db.getFirst("SELECT value")).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(db.close()).rejects.toThrow("close failure");
  await db.close();
  expect(backend.close).toHaveBeenCalledTimes(2);
});

test("synchronous BEGIN failure is translated and leaves the connection available", async () => {
  const backend: SqlBackend = {
    execute: vi.fn().mockImplementationOnce(() => { throw new Error("cannot begin"); })
      .mockResolvedValue({ rows: [{ value: 42 }], rowsAffected: 0 }),
    close: vi.fn(),
  };
  const db = createDatabase(backend);
  await expect(db.transaction(async () => {})).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(await db.getFirst("SELECT value")).toEqual({ value: 42 });
  await db.close();
});

test("synchronous transaction query failures poison later statements and roll back", async () => {
  const backend: SqlBackend = {
    execute: vi.fn((sql: string) => {
      if (sql === "FAIL") throw new Error("native query failure");
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    }),
    close: vi.fn(),
  };
  const db = createDatabase(backend);
  await expect(db.transaction(async tx => {
    const failed = tx.run("FAIL");
    const later = tx.run("SHOULD NOT RUN");
    await expect(failed).rejects.toMatchObject({ code: "E_NATIVE" });
    await expect(later).rejects.toMatchObject({ code: "E_NATIVE" });
  })).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(vi.mocked(backend.execute).mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "FAIL", "ROLLBACK"]);
  await db.close();
});
