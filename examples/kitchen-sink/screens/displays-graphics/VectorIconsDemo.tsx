import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Font from "expo-font";

// Test ID: displays-graphics-vector-icons-loaded once both icon fonts are registered with expo-font.
const ID = "displays-graphics-vector-icons";

/** @expo/vector-icons through its own API; fonts load with expo-font, which supports macOS. */
export function VectorIconsDemo() {
  const [loaded, setLoaded] = useState<string>();
  useEffect(() => {
    Font.loadAsync({ ...Ionicons.font, ...MaterialCommunityIcons.font })
      .then(() => setLoaded(Font.isLoaded("ionicons") && Font.isLoaded("material-community") ? "loaded" : "not registered"), error => setLoaded(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <View style={{ flexDirection: "row", gap: 16 }}>
      <Ionicons name="heart" size={48} color="#ef4444" />
      <Ionicons name="logo-apple" size={48} color="#e5e5e5" />
      <MaterialCommunityIcons name="rocket-launch" size={48} color="#38bdf8" />
    </View>
    <Text className="font-mono text-xs text-foreground" testID={loaded === "loaded" ? `${ID}-loaded` : undefined}>{loaded ?? "loading"}</Text>
  </ScrollView>;
}
