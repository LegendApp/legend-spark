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

/** Polls pmset until the assertion matches `expected`, for up to two seconds. */
async function settles(expected: boolean) {
  for (let waited = 0; waited < 2000; waited += 100) {
    if (await asserted() === expected) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function check() {
  // Development builds hold their own keep-awake tag (Expo's dev tools), so the assertion can already be
  // present; then only the active state is checked.
  const shared = await asserted();
  try {
    await activateKeepAwakeAsync(TAG);
    if (!await settles(true)) return ["no assertion while active"];
  } finally {
    await deactivateKeepAwake(TAG);
  }
  return shared || await settles(false) ? [] : ["assertion kept after deactivate"];
}

/** expo-keep-awake through its own API; Spark's patch gives macOS a power assertion. */
export function KeepAwakeDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => {
    check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`));
    return () => void deactivateKeepAwake(TAG);
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Activates keep-awake, checks pmset lists the display-sleep assertion, then deactivates and checks it is gone.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
