import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as SplashScreen from "expo-splash-screen";

// Test IDs: app-lifecycle-splash-screen-passed, or -failed with the error.
const ID = "app-lifecycle-splash-screen";

/** expo-splash-screen through its own API; macOS has no launch splash, so its calls resolve without effect. */
export function SplashScreenDemo() {
  const [result, setResult] = useState<string>();
  useEffect(() => {
    void (async () => {
      SplashScreen.setOptions({ duration: 200, fade: true });
      await SplashScreen.preventAutoHideAsync();
      SplashScreen.hide();
      await SplashScreen.hideAsync();
    })().then(() => setResult("passed"), error => setResult(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">setOptions, preventAutoHideAsync, hide and hideAsync resolve without a native splash screen.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
