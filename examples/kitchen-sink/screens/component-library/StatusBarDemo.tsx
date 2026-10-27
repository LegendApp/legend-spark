import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { StatusBar, setStatusBarHidden, setStatusBarStyle } from "expo-status-bar";

// Test ID: component-library-expo-status-bar-ran once the component mounted and the setters returned.
const ID = "component-library-expo-status-bar";

/** expo-status-bar on desktop: nothing to style, but apps calling it must not crash. */
export function StatusBarDemo() {
  const [ran, setRan] = useState<string>();
  useEffect(() => {
    try { setStatusBarStyle("light"); setStatusBarHidden(false, "none"); setRan("ran"); }
    catch (error) { setRan(`failed: ${String(error)}`); }
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <StatusBar style="auto" />
    <Text className="font-mono text-xs text-foreground" testID={ran === "ran" ? `${ID}-ran` : undefined}>{ran ?? "…"}</Text>
  </ScrollView>;
}
