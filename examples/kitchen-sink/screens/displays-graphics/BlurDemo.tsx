import { useState } from "react";
import { ScrollView, Text, UIManager, View } from "react-native";
import { BlurView, VibrancyView } from "@react-native-community/blur";

// Test IDs: displays-graphics-blur-registered when both native components are registered;
// displays-graphics-blur-<type>-laid-out once each BlurView has a native frame; displays-graphics-blur-vibrancy-child
// is a VibrancyView child, mounted above the material.
const ID = "displays-graphics-blur";
const types = ["light", "dark", "material", "thinMaterialDark"] as const;
const stripes = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];

/** @react-native-community/blur through its own components; Spark adds the AppKit views. */
export function BlurDemo() {
  const [laidOut, setLaidOut] = useState<Record<string, boolean>>({});
  const registered = UIManager.hasViewManagerConfig("BlurView") && UIManager.hasViewManagerConfig("VibrancyView");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted" testID={registered ? `${ID}-registered` : undefined}>{`Native BlurView and VibrancyView registered: ${registered ? "yes" : "no"}`}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {types.map(type => <View key={type} style={{ width: 200, height: 120, borderRadius: 12, overflow: "hidden" }}>
        <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>{stripes.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
        <BlurView blurType={type} blurAmount={20} reducedTransparencyFallbackColor="#808080" style={{ position: "absolute", inset: 24 }}
          onLayout={event => event.nativeEvent.layout.width > 0 && setLaidOut(previous => ({ ...previous, [type]: true }))} />
        <Text testID={laidOut[type] ? `${ID}-${type}-laid-out` : undefined} style={{ margin: 32, fontWeight: "600" }}>{type}</Text>
      </View>)}
      <View style={{ width: 200, height: 120, borderRadius: 12, overflow: "hidden" }}>
        <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>{stripes.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
        <VibrancyView blurType="material" blurAmount={20} style={{ position: "absolute", inset: 24, justifyContent: "center", alignItems: "center" }}>
          <Text testID={`${ID}-vibrancy-child`} style={{ fontWeight: "600", color: "white" }}>vibrancy</Text>
        </VibrancyView>
      </View>
    </View>
  </ScrollView>;
}
