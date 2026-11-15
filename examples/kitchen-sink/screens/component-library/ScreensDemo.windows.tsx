import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "../../Controls";

export function ScreensDemo() {
  const [active, setActive] = useState("first");
  return <View style={{ padding: 24, gap: 12 }}>
    <Text>Windows JavaScript screen fallback</Text>
    <Text>Native screens are mobile-only. This example switches plain React Native views.</Text>
    <View style={{ height: 80, borderWidth: 1 }}><Text>{`Screen ${active}`}</Text></View>
    <Button onPress={() => setActive(active === "first" ? "second" : "first")}>Switch screen</Button>
  </View>;
}
