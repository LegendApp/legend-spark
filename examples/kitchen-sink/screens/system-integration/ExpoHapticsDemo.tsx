import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { Button } from "../../Controls";

// Test IDs: system-integration-expo-haptics-passed once every haptics call resolves (they reject with
// UnavailabilityError without a native module), or -failed with the error.
const ID = "system-integration-expo-haptics";

async function check() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  await Haptics.selectionAsync();
}

/** expo-haptics through its own API; Spark's patch maps it to NSHapticFeedbackManager. */
export function ExpoHapticsDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => { check().then(() => setResult("passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Rest a finger on a Force Touch trackpad and press the buttons to feel each kind of feedback.</Text>
    <Button onPress={() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}>Notification</Button>
    <Button onPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)}>Impact</Button>
    <Button onPress={() => void Haptics.selectionAsync()}>Selection</Button>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
