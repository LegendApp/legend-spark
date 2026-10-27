import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as SystemUI from "expo-system-ui";

// Test IDs: appearance-theming-system-ui-passed, or -failed with the failing cases.
const ID = "appearance-theming-system-ui";

async function check() {
  await SystemUI.setBackgroundColorAsync("#336699");
  const set = String(await SystemUI.getBackgroundColorAsync()).toUpperCase();
  // null restores the window's default background.
  await SystemUI.setBackgroundColorAsync(null);
  const reset = String(await SystemUI.getBackgroundColorAsync()).toUpperCase();
  return [
    set !== "#336699" && `set (${set})`,
    (reset === "NULL" || reset === "#336699") && `reset (${reset})`,
  ].filter(Boolean);
}

/** expo-system-ui through its own API; Spark's patch sets the main window's background on macOS. */
export function SystemUIDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Sets the main window background, reads it back, then restores the default.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
