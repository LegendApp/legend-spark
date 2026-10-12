import { useState } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { getCurrentRuntime, threadedComponent } from "@react-native-runtimes/core";

// Renders in the isolated "ks-plugins" runtime; module state here lives in that runtime's heap.
let mounts = 0;
function IsolatedPanelContent({ label }: { label?: string }) {
  const [count, setCount] = useState(0);
  const [mount] = useState(() => ++mounts);
  const dark = useColorScheme() === "dark", color = dark ? "#f5f5f5" : "#111827";
  const runtime = getCurrentRuntime();
  return <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: dark ? "#191a1b" : "#f5f6f8" }}>
    <Text style={{ color, fontSize: 22, fontWeight: "700" }}>Isolated runtime window</Text>
    <Text style={{ color }} testID="multiwindow-isolated-runtime">Runtime: {runtime.name} · main: {String(runtime.isMain)}</Text>
    <Text style={{ color }}>Opened with: {label ?? "no label"} · mount #{mount} in this heap</Text>
    <Pressable accessibilityRole="button" testID="multiwindow-isolated-increment" onPress={() => setCount(value => value + 1)} style={{ borderWidth: 1, borderColor: color, borderRadius: 6, padding: 8, alignSelf: "flex-start" }}>
      <Text style={{ color }}>Local count: {count}</Text>
    </Pressable>
  </View>;
}
export const IsolatedPanel = threadedComponent("ks-isolated-panel", IsolatedPanelContent);
