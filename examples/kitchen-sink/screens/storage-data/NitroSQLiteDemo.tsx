import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { open } from "react-native-nitro-sqlite";

// Test IDs: storage-data-nitro-sqlite-passed, or -failed with the failing cases.
const ID = "storage-data-nitro-sqlite";

async function check() {
  const db = open({ name: "kitchen-sink-nitro.sqlite" });
  try {
    db.execute("DROP TABLE IF EXISTS notes");
    db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, score REAL)");
    db.execute("INSERT INTO notes (body, score) VALUES (?, ?)", ["héllo 👋", 1.5]);
    const affected = db.executeBatch([{ query: "INSERT INTO notes (body, score) VALUES (?, ?)", params: [["second", 2], ["third", 3]] }]);
    const rows = (await db.executeAsync<{ body: string; score: number }>("SELECT body, score FROM notes ORDER BY id")).rows?._array ?? [];
    const total = db.execute<{ total: number }>("SELECT sum(score) AS total FROM notes").rows?._array[0]?.total;
    return [
      rows.length !== 3 && `rows (${rows.length})`,
      rows[0]?.body !== "héllo 👋" && "unicode text",
      total !== 6.5 && `sum (${total})`,
      affected.rowsAffected !== 2 && `batch (${JSON.stringify(affected)})`,
    ].filter(Boolean);
  } finally {
    db.delete();
  }
}

/** react-native-nitro-sqlite through its own API; it targets macOS upstream. */
export function NitroSQLiteDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Creates a table, inserts with parameters and a batch, reads rows asynchronously, then deletes the database.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
