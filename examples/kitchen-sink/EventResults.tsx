import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";

export type Entry = { id: number; time: string; text: string; failed: boolean };

export function eventEntry(id: number, value: unknown): Entry {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value) ?? "Event received";
  return { id, time: new Date().toLocaleTimeString(), text, failed: value instanceof Error };
}

export function useEventResults(report: (value: unknown) => void) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const sequence = useRef(0);
  // Native subscriptions retain this callback; new results must not resubscribe.
  const receive = useCallback((value: unknown) => {
    const entry = eventEntry(++sequence.current, value);
    setEntries(previous => [...previous.slice(-5), entry]);
    report(value instanceof Error ? `Error: ${value.message}` : value);
  }, [report]);
  return [entries, receive] as const;
}

export function EventResults({ entries, empty, testID }: { entries: readonly Entry[]; empty: string; testID: string }) {
  return <View className="gap-1 rounded-md border border-border p-3" testID={testID}>
    <Text className="text-sm font-semibold text-foreground">Recent events</Text>
    {entries.length ? entries.map(entry => <Text key={entry.id} selectable
      className={entry.failed ? "text-sm text-danger" : "text-sm text-muted"}>
      {entry.time}  {entry.failed ? "Failed: " : ""}{entry.text}
    </Text>) : <Text className="text-sm text-muted">{empty}</Text>}
  </View>;
}
