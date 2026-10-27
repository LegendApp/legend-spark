import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { Worklets } from "react-native-worklets-core";

// Test IDs: processes-ipc-worklets-core-passed, or -failed with the failing cases.
const ID = "processes-ipc-worklets-core";

async function check() {
  const context = Worklets.createContext("kitchen-sink");
  const counter = Worklets.createSharedValue(0);
  let echoed = "";
  const echo = Worklets.createRunOnJS((value: string) => { echoed = value; });
  const sum = await context.runAsync(() => {
    "worklet";
    let total = 0;
    for (let i = 1; i <= 1000; i++) total += i;
    counter.value = 42;
    echo(`from ${typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === "object" ? "hermes" : "js"} worklet`);
    return total;
  });
  for (let waited = 0; !echoed && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
  return [
    sum !== 500500 && `runAsync (${sum})`,
    counter.value !== 42 && `shared value (${counter.value})`,
    echoed !== "from hermes worklet" && `runOnJS (${echoed || "none"})`,
  ].filter(Boolean);
}

/** react-native-worklets-core through its own API; Spark only adds the macOS build. */
export function WorkletsCoreDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">A worklet sums 1…1000 in its own context, writes a shared value and calls back to the main runtime.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
