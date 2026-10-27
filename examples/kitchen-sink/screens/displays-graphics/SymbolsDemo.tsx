import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { SymbolView, type SymbolViewProps } from "expo-symbols";

// Test IDs: displays-graphics-symbols-native when the native module is linked;
// displays-graphics-symbols-laid-out once every symbol view has a native frame; displays-graphics-symbols-pulse
// wraps the animated symbol, which the golden masks.
const ID = "displays-graphics-symbols";
const symbols: (Omit<SymbolViewProps, "name"> & { name: SymbolViewProps["name"]; label: string })[] = [
  { label: "monochrome", name: "star.fill", tintColor: "#f59e0b" },
  { label: "hierarchical", name: "folder.fill.badge.plus", type: "hierarchical", tintColor: "#3b82f6" },
  { label: "palette", name: "person.crop.circle.badge.checkmark", type: "palette", colors: ["#10b981", "#ef4444"] },
  { label: "multicolor", name: "cloud.sun.rain.fill", type: "multicolor" },
  { label: "bold", name: "heart", weight: "bold", tintColor: "#ec4899" },
  { label: "pulse", name: "wifi", tintColor: "#a855f7", animationSpec: { effect: { type: "pulse" }, repeating: true } },
];

/** expo-symbols through its own API; Spark's patch renders SF Symbols with AppKit. */
export function SymbolsDemo() {
  const [laidOut, setLaidOut] = useState(0);
  const native = requireOptionalNativeModule("SymbolModule") != null;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native module linked: ${native ? "yes" : "no"}`}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }} testID={laidOut >= symbols.length ? `${ID}-laid-out` : undefined}>
      {symbols.map(({ label, ...props }) => <View key={label} testID={props.animationSpec ? `${ID}-pulse` : undefined} style={{ alignItems: "center", gap: 8, width: 96 }}>
        <SymbolView {...props} size={48} fallback={<Text className="text-foreground">missing</Text>}
          onLayout={event => event.nativeEvent.layout.width > 0 && setLaidOut(count => count + 1)} />
        <Text className="text-xs text-muted">{label}</Text>
      </View>)}
    </View>
  </ScrollView>;
}
