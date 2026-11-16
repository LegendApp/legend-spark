import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import RNRestart from "react-native-restart";

// Test IDs: app-lifecycle-restart-restarting just before the first visit restarts the JS runtime (the app
// reloads to its home screen); on the next visit -passed once getReason() returns the reason, or -failed.
const ID = "app-lifecycle-restart";
const REASON = "kitchen-sink-restart-check";

/** react-native-restart: restart(reason) reloads the bundle, and getReason() reports it afterwards. */
export function RestartDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => {
    RNRestart.getReason().then(reason => {
      if (reason === REASON) return setResult("passed");
      if (reason != null) return setResult(`failed: reason ${JSON.stringify(reason)}`);
      setResult("restarting");
      setTimeout(() => RNRestart.restart(REASON), 300);
    }, error => setResult(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Restarts the JavaScript runtime once with a reason, then reads the reason back.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result && `${ID}-${result === "passed" || result === "restarting" ? result : "failed"}`}>{result ?? "running"}</Text>
  </ScrollView>;
}
