import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";

// Test IDs: displays-graphics-image-tint-loaded once all three images loaded and the late tint changed.
// The arrow is opaque black on a transparent background: tinted, only the arrow takes the color.
const ID = "displays-graphics-image-tint";
const arrow = require("./tint-arrow.png");

/** React Native's core Image tintColor: it colors the image's opaque pixels, as on iOS. */
export function ImageTintDemo() {
  const [loaded, setLoaded] = useState(0);
  const [late, setLate] = useState<string>("#3b82f6");
  useEffect(() => { if (loaded === 3) setLate("#ef4444"); }, [loaded]);
  const onLoad = () => setLoaded(count => count + 1);
  const box = { width: 96, height: 96, backgroundColor: "#fde68a" };
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">On a yellow box: the untinted arrow (black), a blue tint, and a tint that changes to red after loading. The yellow must show around each arrow.</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>
      <Image source={arrow} style={box} onLoad={onLoad} testID={`${ID}-plain`} />
      <Image source={arrow} tintColor="#3b82f6" style={box} onLoad={onLoad} testID={`${ID}-blue`} />
      <Image source={arrow} tintColor={late} style={box} onLoad={onLoad} testID={`${ID}-late`} />
    </View>
    <Text className="font-mono text-xs text-foreground" testID={late === "#ef4444" ? `${ID}-loaded` : undefined}>{`loaded ${loaded}/3, late tint ${late}`}</Text>
  </ScrollView>;
}
