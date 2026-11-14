import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import { readClipboard, writeClipboard } from "@legendapp/spark-clipboard";

const ID = "system-integration-expo-clipboard";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";
async function check() {
  const original = await readClipboard();
  try {
    if (!await Clipboard.setStringAsync("Expo clipboard")) throw new Error("String write declined");
    if (!await Clipboard.hasStringAsync() || await Clipboard.getStringAsync() !== "Expo clipboard") throw new Error("String did not round-trip");
    await Clipboard.setStringAsync("<b>Expo HTML</b>", { inputFormat: Clipboard.StringFormat.HTML });
    if (!(await Clipboard.getStringAsync({ preferredFormat: Clipboard.StringFormat.HTML })).includes("Expo HTML")) throw new Error("HTML did not round-trip");
    await Clipboard.setImageAsync(PNG);
    const image = await Clipboard.getImageAsync({ format: "png" });
    if (!await Clipboard.hasImageAsync() || image?.size.width !== 4 || image.size.height !== 2 || !image.data.startsWith("data:image/png;base64,")) throw new Error("PNG did not round-trip");
  } finally {
    const { files, ...content } = original;
    await writeClipboard(files?.length ? { files } : content);
  }
}
export function ExpoClipboardScreen() {
  const [result, setResult] = useState<string>();
  useEffect(() => {
    let active = true;
    void check().then(() => { if (active) setResult("passed"); }, error => { if (active) setResult(`failed: ${String(error)}`); });
    return () => { active = false; };
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">The original expo-clipboard import round-trips plain text, HTML, and a 4×2 PNG through the macOS clipboard.</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
