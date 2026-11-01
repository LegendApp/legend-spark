import "./global.css";
import { useState } from "react";
import { Uniwind } from "uniwind";
import { ScrollView, Text, View } from "react-native";
import { Button, TextInput, Select } from "@legendapp/spark/ui/uniwind";
import * as Clipboard from "@legendapp/spark/clipboard";
import * as SecureStore from "@legendapp/spark/secure-storage";
import * as Linking from "@legendapp/spark/links";

const themes = [{ label: "System", value: "system" }, { label: "Light", value: "light" }, { label: "Dark", value: "dark" }];

export default function Settings() {
  const [name, setName] = useState("");
  const [theme, setTheme] = useState("system");
  const [status, setStatus] = useState("Preferences are held in memory for this demo.");
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<string>) {
    setBusy(true);
    try { setStatus(await work()); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function changeTheme(value: string) {
    if (value !== "system" && value !== "light" && value !== "dark") return;
    Uniwind.setTheme(value);
    setTheme(value);
  }
  return <ScrollView contentInsetAdjustmentBehavior="always" className="flex-1 bg-background" contentContainerClassName="grow items-center p-4 sm:p-6">
    <View className="w-full max-w-2xl gap-3 rounded-xl border border-border bg-surface p-4 sm:p-6" testID="settings-panel">
      <Text accessibilityRole="header" className="text-3xl font-semibold text-foreground">Settings</Text>
      <Text className="text-base text-muted">One screen shared across mobile, web, and desktop.</Text>
      <Text className="mt-2 text-base font-semibold text-foreground">Display name</Text>
      <TextInput accessibilityLabel="Display name" defaultValue="" onChangeText={setName} className="w-full" testID="settings-name" />
      <Text className="mt-2 text-base font-semibold text-foreground">Appearance preference</Text>
      <Select accessibilityLabel="Appearance preference" options={themes} value={theme} onValueChange={changeTheme} className="w-full" testID="settings-theme" />
      <Text className="text-base text-muted">Hello {name || "there"}. Preferred appearance: {theme}.</Text>
      <View className="mt-3 flex-row flex-wrap gap-3">
        <Button className="w-full sm:w-56" disabled={busy} onPress={() => void action(async () => {
          if (!await Clipboard.setStringAsync(JSON.stringify({ name, theme }))) throw new Error("The browser did not permit clipboard access.");
          return "Copied preferences.";
        })}>Copy preferences</Button>
        <Button className="w-full sm:w-56" disabled={busy} onPress={() => void action(async () => {
          if (!await SecureStore.isAvailableAsync()) return "Secure storage is unavailable on this platform.";
          const key = `settings-demo-${Date.now()}`;
          // A disposable synthetic value; no real credentials are entered or displayed.
          try {
            await SecureStore.setItemAsync(key, "demo");
            if (await SecureStore.getItemAsync(key) !== "demo") throw new Error("Secure storage check failed.");
            return "Secure storage verified; demo value removed.";
          } finally { await SecureStore.deleteItemAsync(key); }
        })}>Check secure storage</Button>
        <Button className="w-full sm:w-56" disabled={busy} onPress={() => void action(async () => {
          await Linking.openURL("https://legendapp.com"); return "Opened the Legend website.";
        })}>Open Legend website</Button>
      </View>
      <Text accessibilityLiveRegion="polite" className="mt-3 text-sm text-foreground" testID="settings-status">{status}</Text>
    </View>
  </ScrollView>;
}
