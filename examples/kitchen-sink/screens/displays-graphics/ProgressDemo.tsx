import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import * as Progress from "react-native-progress";

// Test ID: displays-graphics-progress-drawn once the bar, circle and pie lay out.
const ID = "displays-graphics-progress";

/** react-native-progress: bar, circle, pie and indeterminate indicators, drawn with Animated and react-native-svg. */
export function ProgressDemo() {
  const [laidOut, setLaidOut] = useState<string[]>([]);
  const done = (name: string) => () => setLaidOut(previous => previous.includes(name) ? previous : [...previous, name]);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <View onLayout={done("bar")}><Progress.Bar progress={0.4} width={240} /></View>
    <View onLayout={done("circle")} style={{ flexDirection: "row", gap: 16 }}><Progress.Circle progress={0.65} size={64} showsText /><Progress.Pie progress={0.3} size={64} /><Progress.CircleSnail size={64} color={["#ef4444", "#3b82f6", "#10b981"]} /></View>
    <Progress.Bar indeterminate width={240} />
    <Text className="font-mono text-xs text-foreground" testID={laidOut.length === 2 ? `${ID}-drawn` : undefined}>{`laid out ${laidOut.join(", ")}`}</Text>
  </ScrollView>;
}
