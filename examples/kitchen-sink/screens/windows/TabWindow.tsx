import { Text, View } from "react-native";
import { useWindowInstance } from "@legendapp/spark/windows";
import { useAdoptTabWindow } from "./window-tabs";

/** One window of the Window tabs screen. */
export function TabWindow({ label }: { label: string }) {
  const window = useWindowInstance();
  useAdoptTabWindow(window, label);
  return <View className="flex-1 items-center justify-center gap-2 bg-background p-6" testID="windows-window-tabs-window">
    <Text className="text-3xl font-bold text-foreground">Tab {label}</Text>
    <Text className="text-sm text-muted">{window.id}</Text>
    <Text className="text-center text-sm text-muted">The tab bar's + button and Window ▸ New Tab (⌘T) open another tab here.</Text>
  </View>;
}
