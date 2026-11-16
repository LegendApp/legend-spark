import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

// Test IDs: component-library-rn-modal-content while open; -shown-N-closes-M counts onShow and
// onRequestClose (Escape). The screen opens the modal on mount.
const ID = "component-library-rn-modal";

/** React Native's core Modal: covers the window over a dimmed backdrop; Escape requests close. */
export function RNModalDemo() {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(0);
  const [closes, setCloses] = useState(0);
  useEffect(() => { setVisible(true); }, []);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Pressable testID={`${ID}-open`} onPress={() => setVisible(true)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Open modal</Text></Pressable>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-shown-${shown}-closes-${closes}`}>{`shown ${shown}, close requests ${closes}, ${visible ? "open" : "closed"}`}</Text>
    <Modal visible={visible} transparent animationType="fade" onShow={() => setShown(count => count + 1)} onRequestClose={() => { setCloses(count => count + 1); setVisible(false); }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View testID={`${ID}-content`} style={{ backgroundColor: "white", padding: 24, borderRadius: 12, gap: 12, minWidth: 280 }}>
          <Text style={{ color: "black" }}>Core Modal content. Press Escape or Close.</Text>
          <Pressable testID={`${ID}-close`} onPress={() => setVisible(false)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#ef4444", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Close</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}
