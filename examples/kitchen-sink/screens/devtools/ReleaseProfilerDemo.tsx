import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { startProfiling, stopProfiling } from "react-native-release-profiler";
import { getDirectory, readText, remove } from "@legendapp/spark/files";

// Test IDs: devtools-release-profiler-passed, or -failed with the failing cases.
const ID = "devtools-release-profiler";

function busyWork() {
  let total = 0;
  for (let i = 0; i < 2_000_000; i++) total += Math.sqrt(i);
  return total;
}

async function check() {
  startProfiling();
  const deadline = Date.now() + 300;
  while (Date.now() < deadline) busyWork();
  const file = await stopProfiling();
  try {
    const trace = JSON.parse(await readText(file)) as { traceEvents?: unknown[] };
    return {
      file,
      failures: [
        !file.startsWith(`${await getDirectory("cache")}/`) && "cache folder",
        !(trace.traceEvents?.length) && "trace events",
      ].filter(Boolean),
    };
  } finally {
    await remove(file);
  }
}

/** react-native-release-profiler through its own API; Spark only adds the macOS build and cache folder. */
export function ReleaseProfilerDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(({ file, failures }) => setResult(failures.length ? `failed: ${failures.join(", ")} (${file})` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Profiles 300 ms of busy JavaScript with the Hermes sampling profiler and reads back the trace.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
