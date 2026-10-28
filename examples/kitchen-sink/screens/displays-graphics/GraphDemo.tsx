import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LineGraph, type GraphPoint } from "react-native-graph";

// Test IDs: displays-graphics-graph-<static|animated>-laid-out once each graph has rendered and laid out.
// Upstream builds paths with Skia 1's mutable SkPath and threw on Skia 2; the patch uses PathBuilder.
const ID = "displays-graphics-graph";
const points: GraphPoint[] = Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)), value: 50 + 30 * Math.sin(i / 4) + i }));

/** react-native-graph through its own API, drawn with Skia. */
export function GraphDemo() {
  const [laidOut, setLaidOut] = useState<string[]>([]);
  const graph = (name: string, element: React.ReactNode) => <View key={name} style={{ width: 480, height: 160 }}
    testID={laidOut.includes(name) ? `${ID}-${name}-laid-out` : undefined}
    onLayout={() => setLaidOut(previous => previous.includes(name) ? previous : [...previous, name])}>{element}</View>;
  // The animated graph wraps itself in a GestureDetector, which needs a root view.
  return <GestureHandlerRootView style={{ flex: 1 }}><ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted">A static line graph and an animated one with a gradient fill, over 40 points.</Text>
    {graph("static", <LineGraph points={points} animated={false} color="#3b82f6" style={{ flex: 1 }} />)}
    {graph("animated", <LineGraph points={points} animated color="#10b981" gradientFillColors={["#10b98166", "#10b98100"]} enablePanGesture style={{ flex: 1 }} />)}
  </ScrollView></GestureHandlerRootView>;
}
