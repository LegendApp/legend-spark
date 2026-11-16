import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Acorn, Bell, Horse, Lightning } from "phosphor-react-native";

// Test ID: displays-graphics-phosphor-drawn once the icon row lays out at its icon size.
const ID = "displays-graphics-phosphor";

/** phosphor-react-native: icons in several weights drawn by react-native-svg. */
export function PhosphorDemo() {
  const [height, setHeight] = useState(0);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <View onLayout={event => setHeight(Math.round(event.nativeEvent.layout.height))} style={{ flexDirection: "row", gap: 16, alignSelf: "flex-start" }}>
      <Horse size={48} color="#8b5cf6" /><Bell size={48} color="#3b82f6" weight="fill" /><Lightning size={48} color="#f59e0b" weight="duotone" /><Acorn size={48} color="#10b981" weight="bold" />
    </View>
    <Text className="font-mono text-xs text-foreground" testID={height === 48 ? `${ID}-drawn` : undefined}>{`row height ${height}`}</Text>
  </ScrollView>;
}
