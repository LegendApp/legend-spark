import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { BlurView, type BlurTint } from "expo-blur";

// Test IDs: displays-graphics-expo-blur-native when the native module is linked;
// displays-graphics-expo-blur-<tint>-laid-out once each BlurView has a native frame.
const ID = "displays-graphics-expo-blur";
const tints: { tint: BlurTint; intensity: number }[] = [{ tint: "light", intensity: 60 }, { tint: "dark", intensity: 80 }, { tint: "systemMaterial", intensity: 100 }];
const stripes = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];

/** expo-blur through its own API; Spark's patch adds AppKit materials. */
export function ExpoBlurDemo() {
  const [laidOut, setLaidOut] = useState<string[]>([]);
  const native = requireOptionalNativeModule("ExpoBlur") != null;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native module linked: ${native ? "yes" : "no"}`}</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>
      {tints.map(({ tint, intensity }) => <View key={tint} style={{ width: 200, height: 120, borderRadius: 12, overflow: "hidden" }}>
        <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>{stripes.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
        <BlurView tint={tint} intensity={intensity} style={{ position: "absolute", inset: 20 }}
          onLayout={event => event.nativeEvent.layout.width > 0 && setLaidOut(previous => previous.includes(tint) ? previous : [...previous, tint])} />
        <Text testID={laidOut.includes(tint) ? `${ID}-${tint}-laid-out` : undefined} style={{ margin: 28, color: "white", fontWeight: "600" }}>{`${tint} ${intensity}`}</Text>
      </View>)}
    </View>
  </ScrollView>;
}
