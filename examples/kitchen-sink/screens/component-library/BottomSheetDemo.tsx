import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// Test ID: component-library-bottom-sheet-index-1 once the sheet, snapped to its second point, reports it.
const ID = "component-library-bottom-sheet";

/** @gorhom/bottom-sheet through its own API, on Reanimated and Gesture Handler. */
export function BottomSheetDemo() {
  const sheet = useRef<BottomSheet>(null);
  const [index, setIndex] = useState(0);
  // The sheet ignores snaps until it has measured its layout, so keep asking until it reports index 1.
  useEffect(() => {
    if (index === 1) return;
    const timer = setInterval(() => sheet.current?.snapToIndex(1), 300);
    return () => clearInterval(timer);
  }, [index]);
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={{ flex: 1, padding: 24 }}>
      <Text className="font-mono text-xs text-foreground" testID={`${ID}-index-${index}`}>{`sheet index ${index}`}</Text>
      <BottomSheet ref={sheet} snapPoints={[120, 260]} index={0} onChange={setIndex} backgroundStyle={{ backgroundColor: "#1e293b" }}>
        <BottomSheetView style={{ padding: 24 }}><Text style={{ color: "white" }}>Sheet content</Text></BottomSheetView>
      </BottomSheet>
    </View>
  </GestureHandlerRootView>;
}
