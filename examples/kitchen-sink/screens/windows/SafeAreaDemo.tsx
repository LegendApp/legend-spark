import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";

// Test IDs: windows-safe-area-provider-ready once the native provider reports a frame;
// windows-safe-area-view-laid-out once SafeAreaView's child has a size.
const ID = "windows-safe-area";

function Metrics() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const ready = frame.width > 0 && frame.height > 0 && [insets.top, insets.right, insets.bottom, insets.left].every(Number.isFinite);
  return <Text selectable className="font-mono text-xs text-foreground" testID={ready ? `${ID}-provider-ready` : undefined}>
    {`frame ${Math.round(frame.width)}×${Math.round(frame.height)}, insets ${JSON.stringify(insets)}`}
  </Text>;
}

/** react-native-safe-area-context through its own API; it supports macOS upstream. */
export function SafeAreaDemo() {
  const [laidOut, setLaidOut] = useState(false);
  return <SafeAreaProvider style={{ flex: 1 }}>
    <View style={{ padding: 24, gap: 12 }}>
      <Text className="text-sm text-muted">The provider measures its native view; insets are 0 in a standard window.</Text>
      <Metrics />
      <SafeAreaView edges={["top", "bottom"]} style={{ borderWidth: 1, borderColor: "#888", borderRadius: 8 }}>
        <View style={{ padding: 12 }} onLayout={event => setLaidOut(event.nativeEvent.layout.width > 0)}>
          <Text className="text-foreground" testID={laidOut ? `${ID}-view-laid-out` : undefined}>Content inside SafeAreaView</Text>
        </View>
      </SafeAreaView>
    </View>
  </SafeAreaProvider>;
}
