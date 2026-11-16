import { useState } from "react";
import { ScrollView, Text, UIManager } from "react-native";
import LinearGradient from "react-native-linear-gradient";

// Test IDs: displays-graphics-rn-linear-gradient-native when BVLinearGradient is registered;
// displays-graphics-rn-linear-gradient-laid-out once all three gradients have a size.
const ID = "displays-graphics-rn-linear-gradient";

/** react-native-linear-gradient: points, locations, an angle, and a translucent stop over a background. */
export function RNLinearGradientDemo() {
  const [laidOut, setLaidOut] = useState(0);
  const native = UIManager.hasViewManagerConfig("BVLinearGradient");
  const onLayout = (event: { nativeEvent: { layout: { width: number } } }) => { if (event.nativeEvent.layout.width > 0) setLaidOut(count => count + 1); };
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`View manager registered: ${native ? "yes" : "no"}`}</Text>
    <Text className="text-sm text-muted">Top to bottom, red to blue; diagonal with a 40% stop; 90° (left to right) fading to transparent over a yellow view.</Text>
    <LinearGradient colors={["#ef4444", "#3b82f6"]} style={{ width: 320, height: 80 }} onLayout={onLayout} />
    <LinearGradient colors={["#ef4444", "#f59e0b", "#3b82f6"]} locations={[0, 0.4, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: 320, height: 80, borderRadius: 12, overflow: "hidden" }} onLayout={onLayout} />
    <LinearGradient colors={["#22c55e", "rgba(34,197,94,0)"]} useAngle angle={90} style={{ width: 320, height: 80, backgroundColor: "#fde68a" }} onLayout={onLayout} />
    <Text className="font-mono text-xs text-foreground" testID={laidOut >= 3 ? `${ID}-laid-out` : undefined}>{laidOut >= 3 ? "laid out" : "…"}</Text>
  </ScrollView>;
}
