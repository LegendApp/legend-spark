import { useState } from "react";
import { Text, TurboModuleRegistry, UIManager, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, RectButton } from "react-native-gesture-handler";

// Test IDs: component-library-gesture-handler-native when the native module and button component are
// registered; -root-laid-out once the root view and detector mount. Taps and pans need a pointer (manual).
const ID = "component-library-gesture-handler";

/** react-native-gesture-handler through its own API; it supports macOS upstream. */
export function GestureHandlerDemo() {
  const [laidOut, setLaidOut] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const log = (event: string) => setEvents(previous => [event, ...previous].slice(0, 5));
  const native = TurboModuleRegistry.get("RNGestureHandlerModule") != null && UIManager.hasViewManagerConfig("RNGestureHandlerButton");
  const gesture = Gesture.Race(
    Gesture.Tap().runOnJS(true).onEnd((_event, success) => { if (success) log("tap"); }),
    Gesture.Pan().runOnJS(true).onEnd(event => log(`pan ${Math.round(event.translationX)},${Math.round(event.translationY)}`)),
  );
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={{ padding: 24, gap: 12 }} onLayout={() => setLaidOut(true)}>
      <Text className="text-sm text-muted" testID={native ? `${ID}-native` : undefined}>{`Native module and button registered: ${native ? "yes" : "no"}`}</Text>
      <GestureDetector gesture={gesture}>
        <View style={{ height: 120, borderRadius: 12, backgroundColor: "#3b82f6", justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "white" }} testID={laidOut ? `${ID}-root-laid-out` : undefined}>Click or drag here</Text>
        </View>
      </GestureDetector>
      <RectButton onPress={() => log("button")} style={{ padding: 12, borderRadius: 8, backgroundColor: "#10b981" }}>
        <Text style={{ color: "white" }}>RectButton</Text>
      </RectButton>
      <Text className="font-mono text-xs text-foreground">{events.join("  ") || "no events yet"}</Text>
    </View>
  </GestureHandlerRootView>;
}
