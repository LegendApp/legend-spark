import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

// Test ID: displays-graphics-qrcode-drawn once the 160-point code lays out without an error.
const ID = "displays-graphics-qrcode";

/** react-native-qrcode-svg: a QR code generated in JavaScript and drawn by react-native-svg. */
export function QRCodeDemo() {
  const [size, setSize] = useState(0);
  const [error, setError] = useState("");
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <View onLayout={event => setSize(Math.round(event.nativeEvent.layout.height))} style={{ alignSelf: "flex-start", backgroundColor: "white", padding: 0 }}>
      <QRCode value="https://legendapp.com/open-source/spark" size={160} onError={(caught: Error) => setError(String(caught))} />
    </View>
    <Text className="font-mono text-xs text-foreground" testID={size === 160 && !error ? `${ID}-drawn` : undefined}>{error || `size ${size}`}</Text>
  </ScrollView>;
}
