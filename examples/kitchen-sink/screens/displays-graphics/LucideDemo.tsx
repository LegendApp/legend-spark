import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Camera, Heart, Settings, Star } from "lucide-react-native";

// Test ID: displays-graphics-lucide-drawn once the icon row lays out at its icon size.
const ID = "displays-graphics-lucide";

/** lucide-react-native: icons drawn by react-native-svg with size, color and stroke width. */
export function LucideDemo() {
  const [height, setHeight] = useState(0);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <View onLayout={event => setHeight(Math.round(event.nativeEvent.layout.height))} style={{ flexDirection: "row", gap: 16, alignSelf: "flex-start" }}>
      <Camera size={48} color="#3b82f6" /><Heart size={48} color="#ef4444" fill="#fecaca" /><Settings size={48} color="#10b981" strokeWidth={1} /><Star size={48} color="#f59e0b" strokeWidth={3} />
    </View>
    <Text className="font-mono text-xs text-foreground" testID={height === 48 ? `${ID}-drawn` : undefined}>{`row height ${height}`}</Text>
  </ScrollView>;
}
