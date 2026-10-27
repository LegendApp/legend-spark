import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { LinearGradient } from "expo-linear-gradient";

// Test IDs: displays-graphics-linear-gradient-native when the native module is linked;
// displays-graphics-linear-gradient-laid-out once the gradient view has a size.
const ID = "displays-graphics-linear-gradient";

/** expo-linear-gradient through its own API; it supports macOS upstream (CAGradientLayer). */
export function LinearGradientDemo() {
  const [laidOut, setLaidOut] = useState(false);
  const native = requireOptionalNativeModule("ExpoLinearGradient") != null;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native module linked: ${native ? "yes" : "no"}`}</Text>
    <LinearGradient colors={["#ef4444", "#f59e0b", "#3b82f6"]} locations={[0, 0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: 320, height: 160, borderRadius: 12 }} onLayout={event => setLaidOut(event.nativeEvent.layout.width > 0)} />
    <Text className="font-mono text-xs text-foreground" testID={laidOut ? `${ID}-laid-out` : undefined}>{laidOut ? "laid out" : "…"}</Text>
  </ScrollView>;
}
