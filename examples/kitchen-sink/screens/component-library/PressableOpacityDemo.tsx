import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NativePressableOpacity, PressableOpacity } from "react-native-pressable-opacity";

// Test IDs: component-library-pressable-opacity-js and -native once each button lays out.
const ID = "component-library-pressable-opacity";

/** react-native-pressable-opacity's buttons; pressing needs a pointer (manual). */
export function PressableOpacityDemo() {
  const [shown, setShown] = useState<string[]>([]);
  const [presses, setPresses] = useState(0);
  const show = (name: string) => setShown(previous => previous.includes(name) ? previous : [...previous, name]);
  // NativePressableOpacity uses a GestureDetector, which needs a root view.
  return <GestureHandlerRootView style={{ flex: 1 }}><ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <PressableOpacity onPress={() => setPresses(count => count + 1)} onLayout={() => show("js")} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6" }}>
      <Text style={{ color: "white" }} testID={shown.includes("js") ? `${ID}-js` : undefined}>PressableOpacity</Text>
    </PressableOpacity>
    <NativePressableOpacity onPress={() => setPresses(count => count + 1)} onLayout={() => show("native")} style={{ padding: 12, borderRadius: 8, backgroundColor: "#10b981" }}>
      <Text style={{ color: "white" }} testID={shown.includes("native") ? `${ID}-native` : undefined}>NativePressableOpacity</Text>
    </NativePressableOpacity>
    <Text className="font-mono text-xs text-foreground">{`presses ${presses}`}</Text>
  </ScrollView></GestureHandlerRootView>;
}
