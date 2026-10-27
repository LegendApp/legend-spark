import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

// Test IDs: displays-graphics-expo-glass-native when the native module is linked;
// displays-graphics-expo-glass-available-<yes|no> for isGlassEffectAPIAvailable (yes on macOS 26);
// displays-graphics-expo-glass-<name>-child once a glass view's child has laid out.
const ID = "displays-graphics-expo-glass";
const stripes = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];
const backdrop = <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>{stripes.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>;

/** expo-glass-effect through its own API; Spark's patch hosts it in AppKit's NSGlassEffectView. */
export function ExpoGlassDemo() {
  const [laidOut, setLaidOut] = useState<string[]>([]);
  const native = requireOptionalNativeModule("ExpoGlassEffect") != null;
  const available = native && isGlassEffectAPIAvailable();
  const child = (name: string) => <Text testID={laidOut.includes(name) ? `${ID}-${name}-child` : undefined} style={{ fontWeight: "600" }}
    onLayout={() => setLaidOut(previous => previous.includes(name) ? previous : [...previous, name])}>{name}</Text>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native module linked: ${native ? "yes" : "no"}`}</Text>
    <Text className="text-sm text-muted" testID={`${ID}-available-${available ? "yes" : "no"}`}>{`Glass API available: ${available ? "yes" : "no"} · Liquid Glass: ${native && isLiquidGlassAvailable() ? "yes" : "no"}`}</Text>
    <View style={{ width: 640, height: 160, borderRadius: 12, overflow: "hidden", flexDirection: "row", alignItems: "center", justifyContent: "space-around" }}>
      {backdrop}
      <GlassView style={{ width: 160, height: 100, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>{child("regular")}</GlassView>
      <GlassView glassEffectStyle="clear" style={{ width: 160, height: 100, borderRadius: 20, alignItems: "center", justifyContent: "center" }}>{child("clear")}</GlassView>
      <GlassView tintColor="#3b82f680" style={{ width: 160, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" }}>{child("tinted")}</GlassView>
    </View>
    <View style={{ width: 640, height: 120, borderRadius: 12, overflow: "hidden", justifyContent: "center" }}>
      {backdrop}
      <GlassContainer spacing={24} style={{ flexDirection: "row", gap: 12, padding: 12 }}>
        <GlassView style={{ width: 100, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" }}>{child("merged-a")}</GlassView>
        <GlassView style={{ width: 100, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" }}>{child("merged-b")}</GlassView>
      </GlassContainer>
    </View>
  </ScrollView>;
}
