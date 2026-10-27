import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import AppLogs from "react-native-app-logs";

// Test ID: devtools-app-logs-received once a log line this screen wrote comes back from OSLogStore.
const ID = "devtools-app-logs";
const MARKER = "kitchen-sink-app-logs-marker";

/** react-native-app-logs through its own API; Spark adds the macOS build (OSLogStore exists from macOS 12). */
export function AppLogsDemo() {
  const [received, setReceived] = useState<string>();
  useEffect(() => {
    AppLogs.configure({ interval: 0.5 });
    const subscription = AppLogs.registerHandler({ filter: MARKER, handler: ({ logs }) => { if (logs.length) setReceived(logs[0]!.message); } });
    // React Native writes console output to the unified log.
    const timer = setInterval(() => console.warn(MARKER), 500);
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Writes a marker to the console every 0.5 s and waits for it to come back from the app's unified log.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={received ? `${ID}-received` : undefined}>{received ?? "waiting"}</Text>
  </ScrollView>;
}
