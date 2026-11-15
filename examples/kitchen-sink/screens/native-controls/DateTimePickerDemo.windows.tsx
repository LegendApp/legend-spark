import { useState } from "react";
import { Text, TextInput, View } from "react-native";

export function DateTimePickerDemo() {
  const [input, setInput] = useState("2026-01-15T09:30:00.000Z");
  const date = new Date(input);
  return <View style={{ padding: 24, gap: 12 }}>
    <Text>Windows date input (JavaScript fallback)</Text>
    <Text>Enter an ISO date and time, including its time zone.</Text>
    <TextInput accessibilityLabel="ISO date and time" value={input} onChangeText={setInput} style={{ borderWidth: 1, padding: 8 }} />
    <Text>{Number.isNaN(date.getTime()) ? "Invalid date and time" : date.toISOString()}</Text>
  </View>;
}
