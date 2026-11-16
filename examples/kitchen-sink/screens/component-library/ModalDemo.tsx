import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Modal from "react-native-modal";

// Test IDs: the screen opens the modal on mount and closes it once shown: -shows-1-hides-1 after a full cycle.
const ID = "component-library-modal";

/** react-native-modal: an animated modal with a backdrop, over the window through React Native's Modal. */
export function ModalDemo() {
  const [visible, setVisible] = useState(false);
  const [shows, setShows] = useState(0);
  const [hides, setHides] = useState(0);
  useEffect(() => { setVisible(true); }, []);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Pressable testID={`${ID}-open`} onPress={() => setVisible(true)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Open modal</Text></Pressable>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-shows-${shows}-hides-${hides}`}>{`shown ${shows}, hidden ${hides}`}</Text>
    <Modal isVisible={visible} onBackdropPress={() => setVisible(false)} onModalShow={() => { setShows(count => count + 1); if (shows === 0) setTimeout(() => setVisible(false), 500); }} onModalHide={() => setHides(count => count + 1)}>
      <View testID={`${ID}-content`} style={{ backgroundColor: "white", padding: 24, borderRadius: 12, gap: 12 }}>
        <Text>Modal content</Text>
        <Pressable testID={`${ID}-close`} onPress={() => setVisible(false)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#ef4444", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Close</Text></Pressable>
      </View>
    </Modal>
  </View>;
}
