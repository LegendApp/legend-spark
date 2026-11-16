import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import ImageViewing from "react-native-image-viewing";

// Test IDs: component-library-image-viewing-index-1 while the viewer shows the first image;
// -closes-N counts onRequestClose (Escape). The screen opens the viewer on mount.
const ID = "component-library-image-viewing";
const images = [require("../displays-graphics/image-scale.png"), require("../displays-graphics/tint-arrow.png")];

/** react-native-image-viewing: a full-window image viewer over React Native's Modal. */
export function ImageViewingDemo() {
  const [visible, setVisible] = useState(false);
  const [closes, setCloses] = useState(0);
  useEffect(() => { setVisible(true); }, []);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Pressable testID={`${ID}-open`} onPress={() => setVisible(true)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}><Text style={{ color: "white" }}>Open viewer</Text></Pressable>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-closes-${closes}`}>{`close requests ${closes}`}</Text>
    <ImageViewing images={images} imageIndex={0} visible={visible} onRequestClose={() => { setCloses(count => count + 1); setVisible(false); }}
      HeaderComponent={({ imageIndex }) => <Text testID={`${ID}-index-${imageIndex + 1}`} style={{ color: "white", padding: 24 }}>{`${imageIndex + 1} / ${images.length}`}</Text>} />
  </View>;
}
