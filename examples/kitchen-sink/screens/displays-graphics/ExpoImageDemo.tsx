import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { toByteArray } from "base64-js";
import { getDirectory, writeBytes } from "@legendapp/spark/files";

// Test IDs: displays-graphics-expo-image-passed, or -failed with the failing cases. Offline: the image
// is a 4×2 PNG written to the app's data folder.
const ID = "displays-graphics-expo-image";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";

/** expo-image through its own API; on macOS Spark's stand-in renders it with React Native's Image. */
export function ExpoImageDemo() {
  const [uri, setUri] = useState<string>();
  const [result, setResult] = useState<string>();
  const [unsupported, setUnsupported] = useState("");
  const [assetLoaded, setAssetLoaded] = useState(false);
  const unsupportedEvents = useRef<string[]>([]);
  const image = useRef<Image>(null);
  const loads = useRef<string[]>([]);
  useEffect(() => {
    void (async () => {
      const file = `${await getDirectory("data")}/expo-image-demo.png`;
      await writeBytes(file, toByteArray(PNG));
      setUri(`file://${file}`);
    })().catch(error => setResult(`failed: ${String(error)}`));
  }, []);
  async function onLoad(width: number, height: number) {
    loads.current.push(`${width}x${height}`);
    if (loads.current.length === 1) { await image.current?.reloadAsync(); return; }
    const prefetched = await Image.prefetch(uri!);
    const failures = [
      loads.current.join() !== "4x2,4x2" && `onLoad (${loads.current.join()})`,
      !prefetched && "prefetch",
    ].filter(Boolean);
    setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed");
  }
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text className="text-sm text-muted">Loads a local PNG, reloads it through the ref, then prefetches it; the tinted copy uses contentFit contain.</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>
      {uri && <Image ref={image} source={{ uri, width: 800, height: 600 }} contentFit="cover" style={{ width: 160, height: 80, borderRadius: 8 }}
        onLoad={event => void onLoad(event.source.width, event.source.height)}
        onError={event => setResult(`failed: onError ${event.error}`)} />}
      {uri && <Image source={uri} contentFit="contain" tintColor="#3b82f6" style={{ width: 160, height: 160, borderWidth: 1, borderColor: "#888" }} />}
    </View>
    <Text className="text-sm text-muted">Bundled image in a 120×60 box; none crops its natural 160×80 size in an 80×40 box. The full image has green/red/blue/yellow bands; the crop shows only red/blue.</Text>
    <View style={{ flexDirection: "row", gap: 16 }}>
      <Image source={require("./image-scale.png")} contentFit="contain" style={{ width: 120, height: 60 }}
        onLoad={event => setAssetLoaded(event.source.width === 160 && event.source.height === 80)} />
      <Image source={require("./image-scale.png")} contentFit="none" style={{ width: 80, height: 40, borderWidth: 1, borderColor: "#888" }} />
      <Image source={{ blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" }} style={{ width: 1, height: 1 }}
        onLoadStart={() => unsupportedEvents.current.push("start")}
        onError={event => unsupportedEvents.current.push(event.error === "expo-image cannot draw blurhash, thumbhash, SF Symbol or ImageRef sources on macOS" ? "error" : event.error)}
        onLoadEnd={() => { unsupportedEvents.current.push("end"); setUnsupported(unsupportedEvents.current.join(",")); }} />
    </View>
    <Text className="text-xs text-foreground" testID={assetLoaded ? `${ID}-asset-loaded` : undefined}>Bundled image: {assetLoaded ? "loaded at 160×80" : "loading"}</Text>
    <Text className="text-xs text-foreground" testID={unsupported === "start,error,end" ? `${ID}-unsupported-passed` : `${ID}-unsupported-failed`}>Unsupported source: {unsupported}</Text>
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
  </ScrollView>;
}
