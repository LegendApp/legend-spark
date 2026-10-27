import { useState } from "react";
import { ScrollView, Text, UIManager, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";

// Test IDs: displays-graphics-masked-view-registered when the native view manager is registered;
// displays-graphics-masked-view-laid-out once the masked view has a native frame.
const ID = "displays-graphics-masked-view";
const stripes = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];

/** @react-native-masked-view/masked-view through its own API; Spark's patch adds the AppKit view. */
export function MaskedViewDemo() {
  const [laidOut, setLaidOut] = useState(false);
  const registered = UIManager.hasViewManagerConfig("RNCMaskedView");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6">
    <Text className="text-sm text-muted" testID={registered ? `${ID}-registered` : undefined}>{`Native RNCMaskedView registered: ${registered ? "yes" : "no"}`}</Text>
    <Text className="text-sm text-muted">Colored stripes show only through the text and the half-transparent circle.</Text>
    <MaskedView testID={laidOut ? `${ID}-laid-out` : undefined} style={{ width: 480, height: 160 }}
      onLayout={event => setLaidOut(event.nativeEvent.layout.width > 0)}
      maskElement={<View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 24 }}>
        <Text style={{ fontSize: 72, fontWeight: "900", color: "black" }}>MASK</Text>
        <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(0, 0, 0, 0.5)" }} />
      </View>}>
      <View style={{ flex: 1, flexDirection: "row" }}>{stripes.map(color => <View key={color} style={{ flex: 1, backgroundColor: color }} />)}</View>
    </MaskedView>
  </ScrollView>;
}
