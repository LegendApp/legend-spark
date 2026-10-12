import { Text, View } from "react-native";
import { useWindowInstance } from "@legendapp/spark/windows";
import { countClockRender, useClockValue, useCommitMark } from "./performance-store";

/** A pooled (or, for comparison, cold) note: its title and window, marking when it first committed. */
export function PerformanceNote({ title, token }: { title: string; token: string }) {
  const window = useWindowInstance();
  useCommitMark(token);
  return <View className="flex-1 items-center justify-center gap-2 bg-background p-5" testID={`multiwindow-performance-note-${token}`}>
    <Text className="text-2xl font-bold text-foreground">{title}</Text>
    <Text className="text-muted" testID="multiwindow-performance-note-window">{window.id}</Text>
  </View>;
}

/** The throttled clock: renders the shared clock value and counts each render. */
export function PerformanceClock() {
  const value = useClockValue();
  countClockRender();
  return <View className="flex-1 items-center justify-center bg-background" testID="multiwindow-performance-clock">
    <Text className="text-4xl font-bold text-foreground" testID={`multiwindow-performance-clock-value-${value}`}>{value}</Text>
  </View>;
}
