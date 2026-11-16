import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";

// Test IDs: system-integration-rn-clipboard-passed, or -failed with the failing step.
const ID = "system-integration-rn-clipboard";

async function check() {
  const previous = await Clipboard.getString();
  const token = `kitchen-sink-${Date.now()}`;
  try {
    Clipboard.setString(token);
    const read = await Clipboard.getString();
    return [read !== token && `read back (${read})`].filter(Boolean);
  } finally { Clipboard.setString(previous); }
}

/** @react-native-clipboard/clipboard: plain text written to and read from the system clipboard. */
export function RNClipboardDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Writes a token to the pasteboard, reads it back, then restores the previous text. Upstream's macOS module implements only getString and setString.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
