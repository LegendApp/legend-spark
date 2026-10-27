import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import FastImage, { type FastImageRef } from "react-native-fast-image";
import { toByteArray } from "base64-js";
import { getDirectory, writeBytes } from "@legendapp/spark/files";

// Test IDs: displays-graphics-fast-image-passed, or -failed with the failing cases. Offline: the image
// is a 4×2 PNG written to the app's data folder.
const ID = "displays-graphics-fast-image";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";

/** react-native-fast-image through its own API; on macOS Spark's stand-in renders it with Image. */
export function FastImageDemo() {
  const [uri, setUri] = useState<string>();
  const [result, setResult] = useState<string>();
  const image = useRef<FastImageRef>(null);
  const loads = useRef<string[]>([]);
  useEffect(() => {
    void (async () => {
      const file = `${await getDirectory("data")}/fast-image-demo.png`;
      await writeBytes(file, toByteArray(PNG));
      setUri(`file://${file}`);
    })().catch(error => setResult(`failed: ${String(error)}`));
  }, []);
  async function onLoad(width: number, height: number) {
    loads.current.push(`${width}x${height}`);
    if (loads.current.length === 1) { image.current?.reload(); return; }
    const [preloaded] = await FastImage.preload([{ uri: uri! }]);
    const failures = [
      loads.current.join() !== "4x2,4x2" && `onLoad (${loads.current.join()})`,
      !(preloaded?.ok && preloaded.width === 4 && preloaded.height === 2) && `preload (${JSON.stringify(preloaded)})`,
      FastImage.priority.high !== "high" && "constants",
    ].filter(Boolean);
    setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed");
  }
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Loads a local PNG, reloads it through the ref, then preloads it; the tinted copy uses objectFit contain.</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>
      {uri && <FastImage ref={image} source={{ uri }} objectFit="cover" style={{ width: 160, height: 80, borderRadius: 8 }}
        onLoad={event => void onLoad(event.nativeEvent.width, event.nativeEvent.height)}
        onError={event => setResult(`failed: onError ${event.nativeEvent.error}`)} />}
      {uri && <FastImage source={{ uri }} objectFit="contain" tintColor="#3b82f6" style={{ width: 160, height: 160, borderWidth: 1, borderColor: "#888" }} />}
    </View>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
