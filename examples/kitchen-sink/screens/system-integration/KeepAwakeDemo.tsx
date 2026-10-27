import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as processes from "@legendapp/spark/processes";

// Test IDs: system-integration-keep-awake-passed, or -failed with the failing cases.
const ID = "system-integration-keep-awake";
const TAG = "kitchen-sink-keep-awake";

/** Whether pmset lists this app's "expo-keep-awake" display-sleep assertion. */
async function asserted() {
  const result = await processes.runCommand({ target: { type: "executable", path: "/usr/bin/pmset" }, args: ["-g", "assertions"] });
  return new TextDecoder().decode(result.stdout).split("\n").some(line => line.includes("PreventUserIdleDisplaySleep") && line.includes('"expo-keep-awake"'));
}

async function check() {
  const before = await asserted();
  await activateKeepAwakeAsync(TAG);
  await new Promise(resolve => setTimeout(resolve, 300));
  const during = await asserted();
  await deactivateKeepAwake(TAG);
  await new Promise(resolve => setTimeout(resolve, 300));
  const after = await asserted();
  return [before && "asserted before activate", !during && "no assertion while active", after && "assertion kept after deactivate"].filter(Boolean);
}

/** expo-keep-awake through its own API; Spark's patch gives macOS a power assertion. */
export function KeepAwakeDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Activates keep-awake, checks pmset lists the display-sleep assertion, then deactivates and checks it is gone.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
